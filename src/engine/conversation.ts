/**
 * One continuous conversation (docs/PLAN-v2.md, Chat). The model keeps every turn in its chat; when
 * the chat grows past a budget, after a long idle gap, or at a natural end ("I'm going out"), the
 * older turns are compacted into a running summary and a fresh chat starts whose system prompt
 * holds that summary plus the last turns word for word. Pure logic; tested.
 */

/** How long after Sidekick stops talking a new question still counts as a spoken follow-up (Turns.kt). */
export const FOLLOW_UP_MS = 8000;
/** No question for this long: the older turns are compacted. */
export const IDLE_COMPACT_MS = 10 * 60_000;
/** Turns kept word for word after a compaction. */
export const KEEP_VERBATIM = 2;
/** Turns kept (as text) for after a restart; older ones are in the summary and in memory. */
export const MAX_SAVED_TURNS = 12;
/** Rough size: about four characters per token. */
export const CHARS_PER_TOKEN = 4;

/**
 * Recommended chat size before compacting, in tokens, by phone memory. Each kept token costs memory
 * and slows every later answer's reading, so small phones compact sooner. Settings may override.
 */
export function historyBudgetTokens(totalRamMb: number): number {
  if (totalRamMb > 0 && totalRamMb <= 4500) return 1500;
  if (totalRamMb <= 8500) return 2500;
  return 4000;
}

export const tokensOf = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

/** One question and answer, as shown in the chat (not the memory notes sent with it). */
export type Turn = { q: string; a: string; at: number };

export type ChatState = {
  /** Running summary of everything before [turns]. */
  summary: string;
  /** Turns not yet in the summary, oldest first. */
  turns: Turn[];
};

/** Words that may close a sign-off: "…, thanks", "… now, bye". */
const TAIL = String.raw`(\s*,?\s*(now|then|thanks?( you)?|cheers|bye|see you|for now|for (today|the day|a bit|a while)))*\s*[.!]*\s*$`;
const END = [
  String.raw`\b(i'?m|i am|we'?re|we are) (going out|heading (out|off)|off( out| to bed)?|leaving|going to bed|done)`,
  String.raw`\b(that'?s|that is) (all|it|everything)`,
  String.raw`\bthanks?( you)?,? that'?s (it|all)`,
  String.raw`\b(talk|speak) (to you )?(later|soon)`,
  String.raw`\b(bye|goodbye|good ?night|night night|see you( later)?|see ya)`,
].map((p) => new RegExp(p + TAIL, 'i'));

/** "I'm going out", "that's all", "bye", "goodnight": the conversation has come to a natural end. */
export function isNaturalEnd(text: string): boolean {
  const t = text.trim();
  return END.some((r) => r.test(t));
}

export type CompactReason = 'size' | 'idle' | 'end';

/** The model's system prompt for a fresh chat: the usual one plus what came before. */
export function chatSystem(base: string, state: ChatState): string {
  const recent = state.turns.slice(-KEEP_VERBATIM);
  if (!state.summary && !recent.length) return base;
  let s = `${base}\n\nThis is one continuing conversation with the user.`;
  if (state.summary) s += `\nEarlier in it (summary): ${state.summary}`;
  if (recent.length) {
    s += '\nThe last exchanges, word for word:';
    for (const t of recent) s += `\nUser: ${t.q}\nYou: ${t.a}`;
  }
  return s;
}

export const SUMMARY_SYSTEM =
  'You keep a running summary of a conversation between a user and their assistant. Write plain ' +
  'sentences, at most 120 words. Keep names, numbers, places, decisions, plans and open questions; ' +
  'drop small talk. Never invent anything. Reply with the summary only.';

export const SUMMARY_MAX_TOKENS = 200;

export function summaryPrompt(previous: string, turns: Turn[]): string {
  const lines = turns.map((t) => `User: ${t.q}\nAssistant: ${t.a}`).join('\n');
  return `${previous ? `Summary so far: ${previous}\n\n` : ''}New part of the conversation:\n${lines}\n\nUpdated summary:`;
}

/** Cleans the model's summary; null if it is empty or unusable. */
export function parseSummary(reply: string): string | null {
  const s = reply
    .replace(/^\s*(updated )?summary\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length >= 8 ? s.slice(0, 1200) : null;
}

/**
 * The chat as the model holds it. [fresh] = the next question starts a new model chat (first
 * question, after a restart or a compaction); otherwise it continues the one the model has.
 */
export class Conversation {
  state: ChatState;
  private fresh = true;
  /** Rough tokens in the model's current chat (system prompt + every prompt and answer). */
  private used = 0;
  private lastAt = -Infinity;
  private lastSpokeAt = -Infinity;
  /** Turns waiting to be summarised are being summarised now (a second pass waits). */
  compacting = false;

  constructor(
    state?: ChatState,
    public budgetTokens = 2500,
  ) {
    this.state = state ?? { summary: '', turns: [] };
    const last = this.state.turns.at(-1);
    if (last) this.lastAt = last.at;
  }

  /**
   * Whether the next question continues the model's chat (false: start one with [chatSystem]).
   * The arguments are ignored: the chat is always continuous now (kept for older callers).
   */
  keepHistory(_heard?: boolean, _now?: number): boolean {
    return !this.fresh;
  }

  /** A fresh model chat started with this system prompt. */
  started(systemChars: number) {
    this.fresh = false;
    this.used = tokensOf(systemChars);
  }

  /** A question was answered: [promptChars] is everything sent for it (notes included). */
  record(q: string, a: string, promptChars: number, now: number) {
    this.state.turns.push({ q, a, at: now });
    this.used += tokensOf(promptChars + a.length);
    this.lastAt = now;
    this.lastSpokeAt = now;
  }

  /** Sidekick finished speaking (Voice idle): the spoken follow-up window starts again. */
  answered(now: number) {
    this.lastSpokeAt = now;
  }

  /** Said over or right after an answer. */
  isFollowUp(heard: boolean, now: number): boolean {
    return heard || now - this.lastSpokeAt <= FOLLOW_UP_MS;
  }

  usedTokens(): number {
    return this.used;
  }

  /** Why the older turns should be summarised now, if they should. [lastQuestion]: just answered. */
  compactReason(now: number, lastQuestion?: string): CompactReason | null {
    if (this.compacting) return null;
    if (lastQuestion && isNaturalEnd(lastQuestion)) return this.state.turns.length ? 'end' : null;
    if (!this.fresh && this.used > this.budgetTokens) return 'size';
    if (this.idleFor(now) >= IDLE_COMPACT_MS && this.older().length) return 'idle';
    return null;
  }

  /** Time since the last answered question. */
  idleFor(now: number): number {
    return now - this.lastAt;
  }

  /** The model's chat was lost (model unloaded): the next question starts a fresh one. */
  restart() {
    this.fresh = true;
    this.used = 0;
  }

  /** Turns to summarise: all but the last few. */
  older(): Turn[] {
    return this.state.turns.slice(0, Math.max(0, this.state.turns.length - KEEP_VERBATIM));
  }

  /**
   * The first [count] turns are now in [summary] (null: nothing could be summarised); the model's
   * chat restarts from the summary and the last turns.
   */
  compacted(summary: string | null, count: number) {
    if (summary !== null) {
      this.state.summary = summary;
      this.state.turns = this.state.turns.slice(count);
    }
    this.state.turns = this.state.turns.slice(-MAX_SAVED_TURNS);
    this.fresh = true;
    this.used = 0;
  }

  /** Forget everything (Delete all data). */
  reset() {
    this.state = { summary: '', turns: [] };
    this.fresh = true;
    this.used = 0;
    this.lastAt = -Infinity;
    this.lastSpokeAt = -Infinity;
  }
}

export type CompactDeps = {
  /** Runs the summary prompt as a background model pass (yields to questions). */
  summarise: (prompt: string) => Promise<string>;
  /** Counts background passes stopped by a question: a stopped summary is cut short. */
  preemptions: () => number;
  save: (s: ChatState) => void;
  /** Reads the new chat's system prompt in ahead of the next question. */
  prepare?: (system: string) => void;
};

/**
 * Summarises the older turns into the running summary and restarts the model's chat from it.
 * False when nothing changed (a question interrupted it, or the model gave nothing usable): the
 * next trigger tries again.
 */
export async function compact(
  conv: Conversation,
  deps: CompactDeps,
  base: string,
): Promise<boolean> {
  if (conv.compacting) return false;
  conv.compacting = true;
  try {
    const older = conv.older();
    let summary: string | null = null;
    if (older.length) {
      const before = deps.preemptions();
      const reply = await deps.summarise(summaryPrompt(conv.state.summary, older));
      if (deps.preemptions() !== before) return false;
      summary = parseSummary(reply);
      if (!summary) return false;
    }
    conv.compacted(summary, older.length);
    deps.save(conv.state);
    deps.prepare?.(chatSystem(base, conv.state));
    return true;
  } catch (e) {
    console.log(`[chat] compaction failed: ${String(e)}`);
    return false;
  } finally {
    conv.compacting = false;
  }
}

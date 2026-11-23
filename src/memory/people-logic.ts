/**
 * People pages and the live transcript: automatic labels per voice, requests the owner gave
 * someone ("Sam, can you send the report by Friday"), things people said about themselves, and
 * their recent conversations. Pure functions; tested.
 */
import { parseWhen } from './followup-logic';
import { asName } from './names';

export type PersonRef = {
  id: number;
  name: string | null;
  isOwner: boolean;
  /** Stable per voice cluster: "Person 3" until a name is known. */
  labelNo: number | null;
};

/** What a voice is called everywhere: "You", their name, or their automatic label. */
export function speakerLabel(p: PersonRef | null | undefined): string {
  if (!p) return 'Someone';
  if (p.isOwner) return 'You';
  return p.name ?? `Person ${p.labelNo ?? p.id}`;
}

/** The label number for a new voice: one more than any used so far (never reused). */
export function nextLabelNo(existing: (number | null)[]): number {
  return existing.reduce<number>((m, n) => Math.max(m, n ?? 0), 0) + 1;
}

/** Labels for lines, looked up by speaker id at render time, so a rename shows everywhere. */
export function labelFor(
  speakerId: number | null,
  people: Map<number, PersonRef>,
  fallback = 'Someone',
): string {
  if (speakerId == null) return fallback;
  const p = people.get(speakerId);
  return p ? speakerLabel(p) : fallback;
}

/** The one person called [heard] (full name or first name), or null if none or several. */
export function personByName<T extends PersonRef>(heard: string, people: T[]): T | null {
  const h = heard.trim().toLowerCase();
  if (!h) return null;
  const hits = people.filter((p) => {
    if (p.isOwner || !p.name) return false;
    const n = p.name.trim().toLowerCase();
    return n === h || n.split(/\s+/)[0] === h;
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Names mentioned in a question, matching full names and first names ("what did Sam say"). */
export function mentionedPerson<T extends PersonRef>(question: string, people: T[]): T | null {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9' ]/g, ' ')} `;
  const named = people.filter((p) => !p.isOwner && p.name);
  const full = named
    .filter((p) => q.includes(` ${p.name!.toLowerCase()} `))
    .sort((a, b) => b.name!.length - a.name!.length);
  if (full.length) return full[0];
  const first = named.filter((p) => {
    const f = p.name!.toLowerCase().split(/\s+/)[0];
    return f.length >= 2 && (q.includes(` ${f} `) || q.includes(` ${f}'s `));
  });
  return first.length === 1 ? first[0] : null;
}

// --- Requests the owner gave someone ---

export type PersonRequest = { name: string; task: string };

const NAME = "([A-Za-z][a-z'-]{1,20})";
const ASK =
  "(?:can|could|would|will) you(?: please)?|please|i need you to|i'd like you to|don't forget to|remember to|make sure you";
const REQUEST_FIRST = new RegExp(`^${NAME}\\s*,\\s*(?:${ASK})\\s+(.+)$`, 'i');
const REQUEST_LAST = new RegExp(`^(?:${ASK})\\s+(.+?)\\s*,\\s*${NAME}\\s*[?.!]*$`, 'i');
/** Not tasks: "Sam, can you hear me?", "Sam, could you believe it". */
const NOT_TASK = /^(hear|see|believe|imagine|tell me what|remember when|stop|wait)\b/i;

function tidyTask(t: string): string {
  return t
    .trim()
    .replace(/[?.!]+$/, '')
    .replace(/,?\s*(please|for me|thanks|thank you)$/i, '')
    .replace(/^please\s+/i, '')
    .trim();
}

/** "Sam, can you send the report by Friday?" → { name: "Sam", task: "send the report by Friday" }. */
export function findRequest(text: string): PersonRequest | null {
  const t = text.trim();
  let name: string | null = null;
  let task = '';
  const a = REQUEST_FIRST.exec(t);
  if (a) {
    name = asName(a[1]);
    task = a[2];
  } else {
    const b = REQUEST_LAST.exec(t);
    if (b) {
      name = asName(b[2]);
      task = b[1];
    }
  }
  if (!name) return null;
  task = tidyTask(task);
  if (task.split(/\s+/).length < 2 || NOT_TASK.test(task)) return null;
  return { name, task };
}

/** The words for the time in a task ("by Friday", "tomorrow at 3"), or ''. */
export function whenWords(task: string): string {
  const m =
    /\b(?:by|on|before|until|at|this|next|tomorrow|tonight|today|in \w+ (?:minutes?|hours?|days?|weeks?))\b.*$/i.exec(
      task,
    );
  return m ? m[0].trim() : '';
}

/** A request as a follow-up for the owner to track, linked to the person by the caller. */
export function requestFollowup(r: PersonRequest, now: Date) {
  const whenText = whenWords(r.task);
  const due = whenText ? parseWhen(whenText, now) : null;
  const title = r.task[0].toUpperCase() + r.task.slice(1);
  return {
    kind: 'todo' as const,
    title,
    dueAt: due?.at ?? null,
    allDay: due?.allDay ?? false,
    whenText: due ? whenText : '',
  };
}

// --- Things people say about themselves ---

const ABOUT_SELF = [
  /\b(?:i|i'm|i am) (?:a|an) [a-z]+(?: [a-z]+)?\b/i,
  /\bi(?:'ve| have)? (?:live[ds]?|lived|grew up|work(?:ed)?|study|studied|went to school) (?:in|at|for|near|as)\b/i,
  /\bi(?:'m| am) (?:from|allergic to|vegetarian|vegan|married|engaged|retired|pregnant)\b/i,
  /\bi(?:'ve| have) (?:got )?(?:a|an|two|three|\d+) (?:dog|cat|kids?|children|sons?|daughters?|brothers?|sisters?|car|bike)s?\b/i,
  /\bmy (?:wife|husband|partner|girlfriend|boyfriend|son|daughter|kids|children|mum|mom|dad|brother|sister|dog|cat|birthday|job|boss|team)(?:'s| is| are| was)\b/i,
  /\bi (?:love|hate|really like|can't stand|don't eat|don't drink)\b/i,
];
/** Passing states, not facts about someone. */
const NOT_ABOUT_SELF = /\bi(?:'m| am) (?:a bit|a little|an hour|a minute|a second|a few)\b/i;

/** Sentences in a line that look like information about the speaker ("I live in Leeds"). */
export function selfFacts(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < 8 || s.length > 160 || s.endsWith('?')) continue;
    if (NOT_ABOUT_SELF.test(s)) continue;
    if (ABOUT_SELF.some((re) => re.test(s))) out.push(s.replace(/[.!]+$/, ''));
  }
  return out;
}

/** A person fact as a note for the model, using their current name (renames carry over). */
export function personFactNote(name: string, quote: string): string {
  return `${name} said: "${quote}"`;
}

// --- Conversations ---

/** A gap this long between lines starts a new conversation. */
export const CONVERSATION_GAP_MS = 10 * 60_000;

export type Line = { id: number; at: number; text: string; speakerId: number | null };

export type ConversationSummary = { from: number; to: number; lines: Line[] };

/**
 * Splits lines (any order) into conversations by time gaps, newest first, keeping only the
 * conversations [speakerId] spoke in.
 */
export function conversationsWith(
  lines: Line[],
  speakerId: number,
  gapMs = CONVERSATION_GAP_MS,
): ConversationSummary[] {
  const sorted = [...lines].sort((a, b) => a.at - b.at);
  const groups: Line[][] = [];
  for (const l of sorted) {
    const g = groups[groups.length - 1];
    if (g && l.at - g[g.length - 1].at <= gapMs) g.push(l);
    else groups.push([l]);
  }
  return groups
    .filter((g) => g.some((l) => l.speakerId === speakerId))
    .map((g) => ({ from: g[0].at, to: g[g.length - 1].at, lines: g }))
    .reverse();
}

/** The person's notes, facts and what the owner asked of them, for the model. */
export function personContext(
  name: string,
  p: { notes: string; facts: string[]; requests: { title: string; status: string; due: string }[] },
): string {
  const parts: string[] = [];
  if (p.notes.trim()) parts.push(`My notes about ${name}: ${p.notes.trim()}`);
  for (const f of p.facts) parts.push(personFactNote(name, f));
  if (p.requests.length) {
    parts.push(
      `What I asked ${name} to do:\n${p.requests
        .map(
          (r) => `- ${r.title}${r.due ? ` (${r.due})` : ''}${r.status === 'done' ? ' (done)' : ''}`,
        )
        .join('\n')}`,
    );
  } else parts.push(`What I asked ${name} to do: nothing recorded.`);
  return `About ${name}:\n${parts.join('\n')}\n\n`;
}

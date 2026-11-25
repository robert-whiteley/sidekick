/**
 * Automatic conversation notes (docs/PLAN-v2.md): when a conversation heard with Listen on ends,
 * a short note of who was there, topics, decisions and action items. Pure logic; tested.
 */
import { isDuplicate, parseWhen, type ProposedFollowup, TIME_WORDS } from './followup-logic';

/** A conversation has ended after this much silence (or when Listen is turned off). */
export const NOTE_SILENCE_MS = 5 * 60_000;
/** Shorter exchanges ("thanks, bye") get no note. */
export const NOTE_MIN_SPEECH_MS = 2 * 60_000;
export const NOTE_MIN_LINES = 6;
/** Lines given to the model (the phone's context is small): the start and the end. */
export const NOTE_MAX_LINES = 80;

export type HeardLine = {
  id: number;
  at: number;
  text: string;
  /** Live name or label ("Sam", "Person 3"); the owner is 'Me'. */
  who: string;
  isOwner: boolean;
};

export type EndedConversation = { from: number; to: number; lines: HeardLine[] };

/**
 * Splits heard lines (oldest first, all newer than the last note) into conversations at
 * NOTE_SILENCE_MS gaps. Ended ones that are long enough, with someone else in them, are returned;
 * `until` is the time up to which everything has been handled (null: nothing ended yet).
 */
export function endedConversations(
  lines: HeardLine[],
  now: number,
  listening: boolean,
): { ready: EndedConversation[]; until: number | null } {
  const groups: HeardLine[][] = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    if (g && l.at - g[g.length - 1].at < NOTE_SILENCE_MS) g.push(l);
    else groups.push([l]);
  }
  const last = groups[groups.length - 1];
  if (last && listening && now - last[last.length - 1].at < NOTE_SILENCE_MS) groups.pop();
  const ready = groups
    .filter(
      (g) =>
        g.length >= NOTE_MIN_LINES &&
        g[g.length - 1].at - g[0].at >= NOTE_MIN_SPEECH_MS &&
        g.some((l) => !l.isOwner),
    )
    .map((g) => ({ from: g[0].at, to: g[g.length - 1].at, lines: g }));
  const done = groups[groups.length - 1];
  return { ready, until: done ? done[done.length - 1].at : null };
}

/** Who was there, by live name, the owner last ("Sam, Alex and me"). */
export function peopleIn(lines: HeardLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) if (!l.isOwner && !out.includes(l.who)) out.push(l.who);
  return out;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'someone';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function sample(lines: HeardLine[]): HeardLine[] {
  if (lines.length <= NOTE_MAX_LINES) return lines;
  const half = NOTE_MAX_LINES / 2;
  return [...lines.slice(0, half), ...lines.slice(-half)];
}

export function notePrompt(c: EndedConversation): string {
  return (
    'Below is a conversation I had (Me is me). Write short notes of it, exactly four lines:\n' +
    'Topics: what was talked about, separated by ;\n' +
    'Decisions: what was agreed, separated by ;, or none\n' +
    'Actions: who will do what and when, as said (like "Sam will send the deck by Friday"), ' +
    'separated by ;, or none\n' +
    'Summary: one sentence.\n' +
    'Only what was said; do not guess.\n\n' +
    sample(c.lines)
      .map((l) => `${l.who}: ${l.text.slice(0, 200)}`)
      .join('\n')
  );
}

export type ConversationNote = {
  people: string[];
  topics: string[];
  decisions: string[];
  actions: string[];
  summary: string;
};

const NONE = /^(none|n\/a|nothing|no(ne)? (decisions?|actions?)|-)\.?$/i;

function items(reply: string, label: string): string[] {
  const m = new RegExp(`^\\s*[-*•]?\\s*\\**(?:${label})\\**\\s*:\\**\\s*(.*)$`, 'im').exec(reply);
  if (!m) return [];
  return m[m.length - 1]
    .replace(/[*_`]+/g, '')
    .split(/;|\s•\s/)
    .map((s) => s.trim().replace(/[.]+$/, ''))
    .filter((s) => s.length > 1 && s.length <= 160 && !NONE.test(s))
    .slice(0, 6);
}

/** Reads the model's four lines; people come from the voices heard, never from the model. */
export function parseNote(reply: string, c: EndedConversation): ConversationNote | null {
  const note: ConversationNote = {
    people: peopleIn(c.lines),
    topics: items(reply, 'Topics?'),
    decisions: items(reply, 'Decisions?'),
    actions: items(reply, 'Actions?(?: items?)?'),
    summary: items(reply, 'Summary')[0] ?? '',
  };
  if (!note.topics.length && !note.summary) return null;
  return note;
}

/** The stored text (searchable, shown in the Timeline and on the note page). */
export function noteText(n: ConversationNote): string {
  const parts = [`Conversation with ${joinNames(n.people)}`];
  if (n.summary) parts.push(n.summary);
  if (n.topics.length) parts.push(`Topics: ${n.topics.join('; ')}`);
  if (n.decisions.length) parts.push(`Decisions: ${n.decisions.join('; ')}`);
  if (n.actions.length) parts.push(`Action items: ${n.actions.join('; ')}`);
  return parts.join('\n');
}

/**
 * Action items as to-dos for the follow-up approval flow; times ("by Friday") are read from when
 * the conversation ended.
 */
export function actionFollowups(
  actions: string[],
  endedAt: number,
  noteId: number,
): ProposedFollowup[] {
  const out: ProposedFollowup[] = [];
  for (const a of actions) {
    let title = ` ${a} `;
    let whenText = '';
    for (const re of TIME_WORDS) {
      title = title.replace(new RegExp(re.source, 'gi'), (w) => {
        whenText += `${whenText ? ' ' : ''}${w.trim()}`;
        return ' ';
      });
    }
    title = title
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s+(by|before|on|at|until|from)$/i, '')
      .replace(/[,.!]+$/, '');
    if (title.length < 3) continue;
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const when = whenText ? parseWhen(whenText, new Date(endedAt)) : null;
    const p: ProposedFollowup = {
      kind: 'todo',
      title,
      dueAt: when?.at ?? null,
      allDay: when?.allDay ?? false,
      whenText: when ? whenText.slice(0, 60) : '',
      sourceMomentId: noteId,
    };
    if (!out.some((x) => isDuplicate(p, x))) out.push(p);
  }
  return out.slice(0, 5);
}

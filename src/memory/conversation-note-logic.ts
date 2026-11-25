/**
 * Live conversation notes (docs/PLAN-v2.md): while a conversation heard with Listen on goes on, a
 * short note of who is there, topics, decisions and action items, created as soon as there is
 * anything useful and updated as more is said (actions added, changed or marked done). Pure; tested.
 */
import { isDuplicate, parseWhen, type ProposedFollowup, TIME_WORDS } from './followup-logic';
import { type NoteTemplate, parseTemplateSections, templateFormat } from './note-templates';

/** A gap this long (or Listen off) ends a conversation; the next line starts a new one. */
export const NOTE_SILENCE_MS = 5 * 60_000;
/** An update runs after this many new lines, or after a short pause in the talk. */
export const NOTE_BATCH_LINES = 4;
export const NOTE_PAUSE_MS = 20_000;
/** Updates of one conversation at most this often (each is a model pass on the phone). */
export const NOTE_MIN_INTERVAL_MS = 45_000;
/** Lines given to the model (the phone's context is small): the start and the end. */
export const NOTE_MAX_LINES = 80;
/** New lines given to an update, with a few before them for context. */
export const NOTE_UPDATE_LINES = 40;
const NOTE_CONTEXT_LINES = 4;

export type HeardLine = {
  id: number;
  at: number;
  text: string;
  /** Live name or label ("Sam", "Person 3"); the owner is 'Me'. */
  who: string;
  isOwner: boolean;
};

export type Conversation = { from: number; to: number; lines: HeardLine[] };

/** Splits heard lines (oldest first) into conversations at [NOTE_SILENCE_MS] gaps. */
export function splitConversations(lines: HeardLine[]): Conversation[] {
  const groups: HeardLine[][] = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    if (g && l.at - g[g.length - 1].at < NOTE_SILENCE_MS) g.push(l);
    else groups.push([l]);
  }
  return groups.map((g) => ({ from: g[0].at, to: g[g.length - 1].at, lines: g }));
}

/** Has [c] ended: a later one started, a long silence, or Listen is off. */
export const conversationEnded = (
  c: Conversation,
  isLast: boolean,
  now: number,
  listening: boolean,
) => !isLast || !listening || now - c.to >= NOTE_SILENCE_MS;

/** Someone other than the owner is in it (talking alone gets no note). */
export const withSomeone = (c: Conversation) => c.lines.some((l) => !l.isOwner);

/** What has been done for the conversation being written up (kept between passes). */
export type LiveNote = {
  /** The conversation's first line (identifies it). */
  from: number;
  noteId: number | null;
  /** How many of its lines the note covers. */
  handled: number;
  passAt: number;
  note: ConversationNote | null;
  /** When its chat line was first shown (it stays in place as it updates). */
  postedAt: number | null;
  /** The user deleted its note: no more passes for this conversation. */
  deleted?: boolean;
};

export const freshLive = (from: number): LiveNote => ({
  from,
  noteId: null,
  handled: 0,
  passAt: 0,
  note: null,
  postedAt: null,
});

/**
 * Is a model pass due for [c]: new lines with someone else in it, and either it ended, enough new
 * lines came, or the talk paused; never more often than [NOTE_MIN_INTERVAL_MS] while it goes on.
 */
export function notePassDue(c: Conversation, live: LiveNote, now: number, ended: boolean): boolean {
  if (live.deleted || !withSomeone(c)) return false;
  const fresh = c.lines.length - live.handled;
  if (fresh <= 0) return false;
  if (ended) return true;
  if (now - live.passAt < NOTE_MIN_INTERVAL_MS) return false;
  return fresh >= NOTE_BATCH_LINES || now - c.to >= NOTE_PAUSE_MS;
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

const said = (lines: HeardLine[]) =>
  lines.map((l) => `${l.who}: ${l.text.slice(0, 200)}`).join('\n');

const FORMAT =
  'Topics: what was talked about, separated by ;\n' +
  'Decisions: what was agreed, separated by ;, or none\n' +
  'Actions: who will do what and when, as said (like "Sam will send the deck by Friday"), ' +
  'separated by ;, or none. Add (done) after one that was said to be done.\n' +
  'Summary: one sentence.\n' +
  'Only what was said; do not guess.';

/**
 * The model prompt: the whole conversation for a first note; for an update, the current note and
 * only the lines since (with a few before them), so each pass stays short on a phone.
 */
export function notePrompt(
  c: Conversation,
  prev: ConversationNote | null = null,
  handled = 0,
  template: NoteTemplate | null = null,
): string {
  const lines = 4 + (template?.sections.length ?? 0);
  const format = `${FORMAT}${templateFormat(template)}`;
  if (!prev) {
    return (
      `Below is a conversation I am having (Me is me). Write short notes of it, exactly ${lines} lines:\n` +
      `${format}\n\n${said(sample(c.lines))}`
    );
  }
  const fresh = c.lines.slice(handled).slice(-NOTE_UPDATE_LINES);
  const start = Math.max(0, c.lines.length - fresh.length - NOTE_CONTEXT_LINES);
  const before = c.lines.slice(start, c.lines.length - fresh.length);
  const current = [
    `Topics: ${prev.topics.join('; ') || 'none'}`,
    `Decisions: ${prev.decisions.join('; ') || 'none'}`,
    `Actions: ${[...prev.actions, ...prev.done.map((d) => `${d} (done)`)].join('; ') || 'none'}`,
    `Summary: ${prev.summary || 'none'}`,
    ...(prev.sections ?? []).map((x) => `${x.name}: ${x.items.join('; ') || 'none'}`),
  ].join('\n');
  return (
    'These are my notes of a conversation I am having (Me is me):\n' +
    `${current}\n\n` +
    (before.length ? `Said just before:\n${said(before)}\n\n` : '') +
    `Said since:\n${said(fresh)}\n\n` +
    'Rewrite the notes with what was said since: keep what still holds, change what changed, ' +
    `add what is new. Exactly ${lines} lines:\n${format}`
  );
}

export type ConversationNote = {
  people: string[];
  topics: string[];
  decisions: string[];
  /** Still to do. */
  actions: string[];
  /** Said to be done during the conversation. */
  done: string[];
  summary: string;
  /** Extra sections from a note template (meeting: Agenda, …), if one was chosen. */
  sections?: { name: string; items: string[] }[];
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

const DONE = /\s*\((done|completed|finished)\)\s*$/i;

/** Reads the model's four lines; people come from the voices heard, never from the model. */
export function parseNote(
  reply: string,
  c: Conversation,
  template: NoteTemplate | null = null,
): ConversationNote | null {
  const all = items(reply, 'Actions?(?: items?)?');
  const note: ConversationNote = {
    people: peopleIn(c.lines),
    topics: items(reply, 'Topics?'),
    decisions: items(reply, 'Decisions?'),
    actions: all.filter((a) => !DONE.test(a)),
    done: all.filter((a) => DONE.test(a)).map((a) => a.replace(DONE, '')),
    summary: items(reply, 'Summary')[0] ?? '',
  };
  const sections = parseTemplateSections(template, reply);
  if (sections.length) note.sections = sections;
  if (!note.topics.length && !note.summary) return null;
  return note;
}

const same = (a: string, b: string) =>
  isDuplicate({ title: a, dueAt: null }, { title: b, dueAt: null });
const union = (a: string[], b: string[], max: number) => {
  const out = [...a];
  for (const x of b) if (!out.some((y) => same(x, y))) out.push(x);
  return out.slice(-max);
};

/**
 * An update's note merged with the one before: a small model often drops earlier points when it
 * rewrites, so topics, decisions and open actions it no longer lists are kept (unless now done or
 * replaced by a changed version); done ones move out of the open list.
 */
export function mergeNotes(
  prev: ConversationNote | null,
  next: ConversationNote,
): ConversationNote {
  if (!prev) return next;
  const done = union(prev.done, next.done, 8);
  const actions = union(next.actions, prev.actions, 8).filter((a) => !done.some((d) => same(a, d)));
  return {
    people: next.people,
    topics: union(prev.topics, next.topics, 8),
    decisions: union(prev.decisions, next.decisions, 6),
    actions,
    done,
    summary: next.summary || prev.summary,
    ...(next.sections?.length || prev.sections?.length
      ? { sections: next.sections?.length ? next.sections : prev.sections }
      : {}),
  };
}

/** The stored text (searchable, shown in the Timeline and on the note page). */
export function noteText(n: ConversationNote): string {
  const parts = [`Conversation with ${joinNames(n.people)}`];
  if (n.summary) parts.push(n.summary);
  if (n.topics.length) parts.push(`Topics: ${n.topics.join('; ')}`);
  if (n.decisions.length) parts.push(`Decisions: ${n.decisions.join('; ')}`);
  if (n.actions.length) parts.push(`Action items: ${n.actions.join('; ')}`);
  if (n.done.length) parts.push(`Done: ${n.done.join('; ')}`);
  for (const x of n.sections ?? [])
    if (x.items.length) parts.push(`${x.name}: ${x.items.join('; ')}`);
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

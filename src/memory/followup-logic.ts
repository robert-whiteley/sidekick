/**
 * Follow-ups: to-dos, events and reminders the model proposes from what was said, asked or
 * captured. Pure logic (prompt, parsing, dates, dedup, digest) so it can be tested off the phone.
 * Nothing here acts: proposals are saved as "suggested" and wait for the user.
 */

export type FollowupKind = 'todo' | 'event' | 'reminder';
export type FollowupStatus = 'suggested' | 'approved' | 'done' | 'dismissed';

export type Followup = {
  id: number;
  kind: FollowupKind;
  title: string;
  /** When it is due / happens (ms), or null if no time was said. */
  dueAt: number | null;
  /** Only a day was said (no time of day). */
  allDay: boolean;
  /** The words used for the time, as said ("next Tuesday at 3"). */
  whenText: string;
  status: FollowupStatus;
  createdAt: number;
  sourceMomentId: number | null;
  /** The person it was asked of ("Sam, can you …"), when known. */
  personId?: number | null;
  /** That person's current name or label (so renames show). */
  personName?: string | null;
};

export type ProposedFollowup = Pick<
  Followup,
  'kind' | 'title' | 'dueAt' | 'allDay' | 'whenText' | 'sourceMomentId'
>;

export const MAX_FOLLOWUP_LINES = 10;
/** Time used for a reminder when only a day was said. */
export const DEFAULT_HOUR = 9;
const DAY = 86_400_000;

// --- Prompt and reply parsing ---

export function followupPrompt(lines: { text: string; who: string }[]): string {
  return (
    'Below are numbered things said or noted around me. List only clear follow-ups for me: a ' +
    'todo (something I should do), an event (something happening at a time, like an ' +
    'appointment or meeting) or a reminder (something I asked to be reminded about). Write one ' +
    'per line exactly as: line number | todo, event or reminder | short title | when, using the ' +
    'exact words said for when (like "next Tuesday at 3"), or - if no time was said. Do not ' +
    'guess or add anything that was not said. If there are none, write exactly NONE.\n\n' +
    lines.map((l, i) => `${i + 1}. ${l.who}: ${l.text}`).join('\n')
  );
}

const KIND_WORDS: [RegExp, FollowupKind][] = [
  [/^(to-?do|task|action)/, 'todo'],
  [/^(event|meeting|appointment|plan)/, 'event'],
  [/^remind/, 'reminder'],
];

/**
 * Parses the model's reply. [lineAt] gives each numbered line's time and moment id, so relative
 * times ("tomorrow") are read from when it was said, not when the model ran.
 */
export function parseFollowups(
  reply: string,
  lineAt: { at: number; id: number }[],
): ProposedFollowup[] {
  const out: ProposedFollowup[] = [];
  for (const raw of reply.split('\n')) {
    const parts = raw
      .replace(/^\s*[-*•]\s*/, '')
      .replace(/[*_`]+/g, '')
      .split('|')
      .map((p) => p.trim());
    if (parts.length < 4) continue;
    const n = parseInt(parts[0].replace(/\D/g, ''), 10);
    const src = lineAt[n - 1];
    if (!src) continue;
    const kindWord = parts[1].toLowerCase();
    const kind = KIND_WORDS.find(([re]) => re.test(kindWord))?.[1];
    if (!kind) continue;
    const title = cleanTitle(parts[2]);
    if (title.length < 3 || title.length > 100) continue;
    const whenText = /^(-|none|n\/a|no time)?$/i.test(parts[3]) ? '' : parts[3].slice(0, 60);
    const when = whenText ? parseWhen(whenText, new Date(src.at)) : null;
    const p: ProposedFollowup = {
      kind,
      title,
      dueAt: when?.at ?? null,
      allDay: when?.allDay ?? false,
      whenText,
      sourceMomentId: src.id,
    };
    if (!out.some((x) => isDuplicate(p, x))) out.push(p);
    if (out.length >= 5) break;
  }
  return out;
}

function cleanTitle(s: string): string {
  const t = s
    .replace(
      /^(i (need|have|must|should|want) to|remember to|remind me to|don'?t forget to)\s+/i,
      '',
    )
    .replace(/[.!]+$/, '')
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// --- Natural-language times ---

const NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, 'forty-five': 45,
}; // prettier-ignore
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]; // prettier-ignore
const PART_OF_DAY: Record<string, number> = {
  morning: 9, lunchtime: 12, lunch: 12, afternoon: 15, evening: 19, tonight: 20, night: 20,
}; // prettier-ignore

const num = (s: string) => NUMBERS[s] ?? parseInt(s, 10);

function atDay(ref: Date, addDays: number): Date {
  return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + addDays);
}

/**
 * Reads a spoken time ("next Tuesday at 3", "tomorrow morning", "in 20 minutes", "24 December",
 * "at 5:30pm") relative to [ref]. A bare weekday or "next <weekday>" means its next occurrence
 * after today. An hour without am/pm from 1 to 6 is read as afternoon. Only a day → all-day,
 * at DEFAULT_HOUR. Only a time already past today → tomorrow. Returns null if no time is found.
 */
export function parseWhen(phrase: string, ref: Date): { at: number; allDay: boolean } | null {
  const s = ` ${phrase.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ')} `;

  // "in 20 minutes", "in an hour", "in half an hour", "in 3 days", "in two weeks"
  const rel = /\bin (half an|a|an|\d+|[a-z-]+) (minute|min|hour|hr|day|week|month)s?\b/.exec(s);
  if (rel) {
    const n = rel[1] === 'half an' ? 0.5 : num(rel[1]);
    if (!Number.isNaN(n)) {
      const unit = rel[2];
      if (unit.startsWith('min')) return { at: ref.getTime() + n * 60_000, allDay: false };
      if (unit.startsWith('h')) return { at: ref.getTime() + n * 3_600_000, allDay: false };
      const days = unit === 'day' ? n : unit === 'week' ? n * 7 : 0;
      const d =
        unit === 'month'
          ? new Date(ref.getFullYear(), ref.getMonth() + n, ref.getDate())
          : atDay(ref, days);
      return withTime(d, s, ref, true);
    }
  }

  let day: Date | null = null;
  if (/\b(day after tomorrow)\b/.test(s)) day = atDay(ref, 2);
  else if (/\b(tomorrow|tmrw)\b/.test(s)) day = atDay(ref, 1);
  else if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(s)) day = atDay(ref, 0);
  else if (/\bnext week\b/.test(s))
    day = atDay(ref, (1 - ref.getDay() + 7) % 7 || 7); // Monday
  else if (/\b(this |at the )?weekend\b/.test(s))
    day = atDay(ref, ref.getDay() % 6 === 0 ? 0 : 6 - ref.getDay());
  if (!day) {
    const wd = WEEKDAYS.findIndex((w) =>
      new RegExp(`\\b(${w}|${w.slice(0, 3)}|${w.slice(0, 4)}s?)\\b`).test(s),
    );
    if (wd >= 0) day = atDay(ref, (wd - ref.getDay() + 7) % 7 || 7);
  }
  if (!day) day = calendarDate(s, ref);
  return withTime(day, s, ref, false);
}

function calendarDate(s: string, ref: Date): Date | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
  const ord = '(\\d{1,2})(?:st|nd|rd|th)?';
  let m: RegExpExecArray | null;
  let month = -1;
  let date = 0;
  let year: number | null = null;
  if ((m = new RegExp(`\\b${ord} (?:of )?${mon}(?: (\\d{4}))?\\b`).exec(s))) {
    [date, month, year] = [+m[1], MONTHS.indexOf(m[2]), m[3] ? +m[3] : null];
  } else if ((m = new RegExp(`\\b${mon} (?:the )?${ord}(?: (\\d{4}))?\\b`).exec(s))) {
    [month, date, year] = [MONTHS.indexOf(m[1]), +m[2], m[3] ? +m[3] : null];
  } else if ((m = /\bthe (\d{1,2})(?:st|nd|rd|th)\b/.exec(s))) {
    const d = +m[1];
    const thisMonth = new Date(ref.getFullYear(), ref.getMonth(), d);
    return thisMonth >= atDay(ref, 0)
      ? thisMonth
      : new Date(ref.getFullYear(), ref.getMonth() + 1, d);
  }
  if (month < 0 || date < 1 || date > 31) return null;
  const d = new Date(year ?? ref.getFullYear(), month, date);
  if (year == null && d < atDay(ref, 0)) d.setFullYear(d.getFullYear() + 1);
  return d;
}

function withTime(
  day: Date | null,
  s: string,
  ref: Date,
  dayIsExplicitOffset: boolean,
): { at: number; allDay: boolean } | null {
  const t = timeOfDay(s);
  if (!day && !t) return null;
  if (!t) {
    const d = day!;
    return {
      at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), DEFAULT_HOUR).getTime(),
      allDay: true,
    };
  }
  const base = day ?? atDay(ref, 0);
  let at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), t.h, t.m).getTime();
  if (!day && !dayIsExplicitOffset && at <= ref.getTime()) at += DAY; // time only, already past
  return { at, allDay: false };
}

function timeOfDay(s: string): { h: number; m: number } | null {
  if (/\b(noon|midday)\b/.test(s)) return { h: 12, m: 0 };
  if (/\bmidnight\b/.test(s)) return { h: 23, m: 59 };
  const part = Object.keys(PART_OF_DAY).find((p) => new RegExp(`\\b${p}\\b`).test(s));
  const pm = /\b(afternoon|evening|tonight|night)\b/.test(s);

  let h = -1;
  let m = 0;
  let mer: string | undefined;
  let r: RegExpExecArray | null;
  if ((r = /\b(half|quarter) (past|to) (\d{1,2}|[a-z]+)\b/.exec(s))) {
    h = num(r[3]);
    m = r[1] === 'half' ? 30 : r[2] === 'past' ? 15 : -15;
    if (m < 0) [h, m] = [h - 1, 45];
  } else if ((r = /\b(\d{1,2})[:h](\d{2}) ?(am|pm|a m|p m)?\b/.exec(s))) {
    [h, m, mer] = [+r[1], +r[2], r[3]];
  } else if ((r = /\b(\d{1,2}) ?(am|pm|a m|p m|o'?clock)\b/.exec(s))) {
    [h, mer] = [+r[1], r[2]];
  } else if ((r = /\b(?:at|by|from|around) (\d{1,2}|[a-z]+)\b/.exec(s))) {
    const n = num(r[1]);
    if (!Number.isNaN(n) && n >= 0 && n <= 23) h = n;
  }
  if (h < 0 || Number.isNaN(h) || h > 23 || m > 59)
    return part ? { h: PART_OF_DAY[part], m: 0 } : null;
  const meridiem = mer?.replace(' ', '');
  if (meridiem === 'pm' && h < 12) h += 12;
  else if (meridiem === 'am' && h === 12) h = 0;
  else if (meridiem !== 'am' && meridiem !== 'pm' && h < 12 && h >= 1 && (h <= 6 || pm)) h += 12;
  return { h, m };
}

// --- Duplicates ---

const STOP = new Set(
  'a an the to my me i for of on at in with and need should must remember remind reminder please go do'.split(
    ' ',
  ),
);

export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w && !STOP.has(w));
}

/** Same thing said twice: near-identical titles, and times (if both have one) within 12 hours. */
export function isDuplicate(
  a: Pick<Followup, 'title' | 'dueAt'>,
  b: Pick<Followup, 'title' | 'dueAt'>,
): boolean {
  const ta = new Set(titleTokens(a.title));
  const tb = new Set(titleTokens(b.title));
  if (!ta.size || !tb.size) return a.title.toLowerCase() === b.title.toLowerCase();
  const shared = [...ta].filter((w) => tb.has(w)).length;
  const similar =
    shared / (ta.size + tb.size - shared) >= 0.6 || shared === Math.min(ta.size, tb.size);
  if (!similar) return false;
  if (a.dueAt == null || b.dueAt == null) return true;
  return Math.abs(a.dueAt - b.dueAt) < 12 * 3_600_000;
}

/** Proposals not already known (in any state, so dismissed ones don't come back). */
export function newProposals<T extends Pick<Followup, 'title' | 'dueAt'>>(
  proposed: T[],
  existing: Pick<Followup, 'title' | 'dueAt'>[],
): T[] {
  const out: T[] = [];
  for (const p of proposed) {
    if (existing.some((e) => isDuplicate(p, e)) || out.some((o) => isDuplicate(p, o))) continue;
    out.push(p);
  }
  return out;
}

// --- Showing them ---

const KIND_LABEL: Record<FollowupKind, string> = {
  todo: 'To-do',
  event: 'Event',
  reminder: 'Reminder',
};
export const kindLabel = (k: FollowupKind) => KIND_LABEL[k];

export function formatDue(f: Pick<Followup, 'dueAt' | 'allDay'>, now: Date): string {
  if (f.dueAt == null) return '';
  const d = new Date(f.dueAt);
  const diff = Math.round((atDay(d, 0).getTime() - atDay(now, 0).getTime()) / DAY);
  const dayName =
    diff === 0
      ? 'today'
      : diff === 1
        ? 'tomorrow'
        : diff === -1
          ? 'yesterday'
          : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (f.allDay) return dayName;
  return `${dayName} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

const isOpen = (f: Followup) => f.status === 'approved';
const onDay = (f: Followup, day: Date) =>
  f.dueAt != null && f.dueAt >= atDay(day, 0).getTime() && f.dueAt < atDay(day, 1).getTime();

/**
 * The morning digest for [day]: what is due that day, what was due yesterday and is still open,
 * and how many undated to-dos are open. Null if there is nothing to say.
 */
export function digestText(items: Followup[], day: Date): string | null {
  const open = items.filter(isOpen).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const today = open.filter((f) => onDay(f, day));
  const yesterday = open.filter((f) => onDay(f, atDay(day, -1)));
  const undated = open.filter((f) => f.dueAt == null && f.kind === 'todo').length;
  const parts: string[] = [];
  const name = (f: Followup) =>
    f.allDay ? f.title : `${f.title} (${formatDue(f, day).replace(/^today /, '')})`;
  if (today.length) parts.push(`Today: ${today.map(name).join('; ')}.`);
  if (yesterday.length)
    parts.push(`Still open from yesterday: ${yesterday.map((f) => f.title).join('; ')}.`);
  if (undated) parts.push(`${undated} open to-do${undated === 1 ? '' : 's'}.`);
  return parts.length ? parts.join(' ') : null;
}

/** "What do I need to do?", "anything on tomorrow?", "my reminders" … */
export function asksAboutFollowups(q: string): boolean {
  return (
    /\bwhat (do|should|have|must) i (got |need |have )?(to )?do\b/i.test(q) ||
    /\b(my|any) (to-?dos?|todo list|tasks|reminders|follow-?ups|agenda|schedule|appointments|plans)\b/i.test(
      q,
    ) ||
    /\bwhat('s| is| have i got) (on|planned|coming up|happening|due)\b/i.test(q) ||
    /\b(anything|something) (i need|i have|to do|on|due|planned)\b/i.test(q) ||
    /\bdo i have (anything|any|something)\b/i.test(q) ||
    /\bwhat('s| is) next\b/i.test(q)
  );
}

/** Open follow-ups as notes for the model, soonest first, undated last (bounded). */
export function followupContext(items: Followup[], now: Date, limit = 12): string {
  const open = items
    .filter(isOpen)
    .filter((f) => f.dueAt == null || f.dueAt >= atDay(now, -1).getTime())
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
    .slice(0, limit);
  if (!open.length) return 'My follow-ups: none approved.\n\n';
  const lines = open.map((f) => {
    const due = formatDue(f, now);
    const who = f.personName ? ` (asked of ${f.personName})` : '';
    return `- ${kindLabel(f.kind)}: ${f.title}${who}${due ? ` (${due})` : ''}`;
  });
  return `My follow-ups (approved by me):\n${lines.join('\n')}\n\n`;
}

// --- Spoken "remind me …" ---

const TIME_WORDS = [
  /\bin (half an|a|an|\d+|[a-z-]+) (minute|min|hour|hr|day|week|month)s?\b/g,
  /\b(the )?day after tomorrow\b/g,
  /\b(tomorrow|tmrw|today|tonight)( (morning|afternoon|evening|night))?\b/g,
  /\bthis (morning|afternoon|evening|weekend)\b/g,
  /\b(next|this|on) (week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g,
  /\b(on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/g,
  /\b(on )?(the )?\d{1,2}(st|nd|rd|th)?( of)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*( \d{4})?\b/g,
  /\b(on )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (the )?\d{1,2}(st|nd|rd|th)?( \d{4})?\b/g,
  /\b(at|by|around) (noon|midday|midnight|lunchtime|lunch)\b/g,
  /\b(at|by|around) (half|quarter) (past|to) (\d{1,2}|[a-z]+)\b/g,
  /\b(at|by|around) \d{1,2}([:h]\d{2})? ?(am|pm|a m|p m|o'?clock)?\b/g,
  /\b(at|by|around) (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)( (am|pm|o'?clock))?\b/g,
  /\b\d{1,2}([:h]\d{2})? ?(am|pm|a m|p m)\b/g,
  /\b(in the )?(morning|afternoon|evening)\b/g,
];

/**
 * "Remind me to call the dentist tomorrow at nine" / "remind me in 20 minutes to check the oven":
 * the reminder's title and time, worked out without the model so it is really scheduled. No time
 * found → an undated to-do. Null when the words aren't a reminder request.
 */
export function parseReminderRequest(
  q: string,
  now: Date,
): Pick<Followup, 'kind' | 'title' | 'dueAt' | 'allDay' | 'whenText'> | null {
  const m =
    /^(?:hey )?(?:sidekick,? )?(?:please )?(?:(?:can|could|will) you )?remind me (.+?)[.!?]*$/i.exec(
      q.trim(),
    );
  if (!m) return null;
  const rest = m[1].replace(/\s+/g, ' ');
  // "Remind me what Sam said" / "remind me where I parked" are questions about memory.
  if (/^(what|where|who|whom|whose|when|how|which|why|if|whether|again)\b/i.test(rest)) return null;
  // A request: "to …", "about …", "that …", or a time first ("in 20 minutes to …").
  if (!/^(to|about|that|of)\b/i.test(rest) && !/\b(to|about|that)\b/i.test(rest)) return null;
  const when = parseWhen(rest, now);
  let title = ` ${rest} `;
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
    .replace(/^(to|about|that|of)\s+/i, '')
    .replace(/\s+(to|about|that|and|please)$/i, '')
    .replace(/[,.!]+$/, '')
    .trim();
  if (!title) return null;
  title = cleanTitle(title);
  if (!when) return { kind: 'todo', title, dueAt: null, allDay: false, whenText: '' };
  return { kind: 'reminder', title, dueAt: when.at, allDay: when.allDay, whenText };
}

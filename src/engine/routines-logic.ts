/**
 * Routines: standing instructions the user sets up by voice or typing ("every day at 6pm give me
 * a recap of my day", "whenever Sam messages me, read it out"). At the time (or when the trigger
 * happens) the instruction is run like a question, so the result is dynamic. Pure logic: parsing,
 * next run times, due / late checks, limits, prompts. Tested in __tests__/routines-logic-test.ts.
 */
import { clockTime } from '@/integrations/parse';

export type Schedule =
  | { type: 'daily'; hour: number; minute: number }
  /** days: 0 = Sunday … 6 = Saturday. */
  | { type: 'weekly'; days: number[]; hour: number; minute: number }
  | { type: 'once'; at: number }
  | { type: 'interval'; everyMin: number };

export type Trigger =
  | { type: 'message'; who: string | null; app: string | null }
  | { type: 'event'; minutesBefore: number }
  | { type: 'headphones' }
  | { type: 'car' }
  | { type: 'charging' }
  | { type: 'unlock' }
  | { type: 'place'; place: string; edge: 'enter' | 'leave' };

export type When = Schedule | Trigger;

export type Routine = {
  id: string;
  /** What the user said, for the list. */
  said: string;
  /** The instruction run each time ("give me a recap of my day"). */
  action: string;
  when: When;
  paused: boolean;
  createdAt: number;
  /** Last run (ms), or null. Scheduled routines: the due time it ran for. */
  lastRunAt: number | null;
  /** Interval routines: when the interval started counting. */
  anchor?: number;
};

export const MAX_ROUTINES = 20;
export const MIN_INTERVAL_MIN = 15;
/** A missed time still runs (marked late) within this long; older misses are skipped. */
export const LATE_LIMIT_MS = 12 * 3_600_000;
/** Ran more than this after its time: say so. */
export const LATE_AFTER_MS = 5 * 60_000;
/** Same trigger routine again no sooner than this (messages: per message, 1 min). */
export const TRIGGER_GAP_MS = 15 * 60_000;
export const MESSAGE_GAP_MS = 60_000;

export function isSchedule(w: When): w is Schedule {
  return w.type === 'daily' || w.type === 'weekly' || w.type === 'once' || w.type === 'interval';
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PART: Record<string, { hour: number; minute: number }> = {
  morning: { hour: 8, minute: 0 },
  afternoon: { hour: 14, minute: 0 },
  evening: { hour: 18, minute: 0 },
  night: { hour: 21, minute: 0 },
};
const DEFAULT_TIME = { hour: 8, minute: 0 };

/** "at 6pm", "at 18:30", "at 8" at the start of [s]: the time and the rest. */
function leadingTime(s: string): { time: { hour: number; minute: number } | null; rest: string } {
  const m =
    /^\s*at\s+(noon|midday|midnight|\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm|o'?clock)?)(?=[\s,.:;!?]|$)/i.exec(
      s,
    );
  if (!m) return { time: null, rest: s };
  const t = clockTime(m[1]);
  if (!t) return { time: null, rest: s };
  return { time: t, rest: s.slice(m[0].length) };
}

function cleanAction(s: string): string {
  return s
    .replace(/^[\s,:;.-]+/, '')
    .replace(/^(?:please\s+|can you\s+|could you\s+|then\s+|sidekick\s*,?\s*)+/i, '')
    .replace(/[\s.!]+$/, '')
    .trim();
}

export type ParseResult =
  { ok: true; when: When; action: string } | { ok: false; reason: string } | null;

/**
 * Reads a routine request. Null when [text] isn't one (so the normal answer runs). Reminders
 * ("remind me every Monday …") are not routines: they are parsed earlier.
 */
export function parseRoutine(text: string, now: Date): ParseResult {
  const t = text
    .trim()
    .replace(/^(?:hey\s+)?sidekick[,\s]+/i, '')
    .replace(/^(?:please\s+)?(?:from now on,?\s+)?/i, '');
  if (/^remind me\b/i.test(t) || /\bremind me (?:to|about|that)\b/i.test(t)) return null;
  return parseScheduled(t, now) ?? parseTrigger(t);
}

function parseScheduled(t: string, now: Date): ParseResult {
  let m: RegExpExecArray | null;
  // "every 2 hours …", "every 30 minutes …", "every hour …"
  if (
    (m =
      /^(?:every|each)\s+(?:(\d+|an?|one|two|three|four|six|twelve)\s+)?(hours?|minutes?|mins?)\b(.*)$/i.exec(
        t,
      ))
  ) {
    const W: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, six: 6, twelve: 12 }; // prettier-ignore
    const n = m[1] ? (W[m[1].toLowerCase()] ?? parseInt(m[1], 10)) : 1;
    const everyMin = /^h/i.test(m[2]) ? n * 60 : n;
    const action = cleanAction(m[3]);
    if (!action) return null;
    if (everyMin < MIN_INTERVAL_MIN)
      return { ok: false, reason: `Routines can run at most every ${MIN_INTERVAL_MIN} minutes.` };
    return { ok: true, when: { type: 'interval', everyMin }, action };
  }
  // "every day / morning / evening / weekday / weekend / Monday (and Thursday) [at T] …"
  m =
    /^(?:every|each)\s+(single\s+)?(day|morning|afternoon|evening|night|week\s?day|weekend(?:\s+day)?|(?:(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?(?:\s*(?:,|and|&)\s*)?)+)(?:\s+(morning|afternoon|evening|night))?\b(.*)$/i.exec(
      t,
    ) ??
    /^(?:daily|on\s+weekdays|weekdays)\b()()()(.*)$/i.exec(t) ??
    /^(?:in\s+the\s+|each\s+|every\s+)?(?:(morning|evening|night)s)\b()()(.*)$/i.exec(t);
  if (m) {
    const what = (m[2] ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    let part = (m[3] ?? '').toLowerCase();
    let rest = m[4] ?? '';
    const lead = t.toLowerCase();
    let days: number[] | null = null;
    if (/^(?:on\s+)?weekdays/.test(lead) || /^week ?day/.test(what)) days = [1, 2, 3, 4, 5];
    else if (/^weekend/.test(what)) days = [0, 6];
    else if (DAYS.some((d) => what.includes(d)))
      days = DAYS.flatMap((d, i) => (what.includes(d) ? [i] : []));
    else if (PART[what]) part ||= what;
    else if (!what && m[1] && PART[m[1].toLowerCase()]) part = m[1].toLowerCase();
    const lt = leadingTime(rest);
    rest = lt.rest;
    if (!lt.time && /^\s*(morning|afternoon|evening|night)\b/i.test(rest)) {
      part = /^\s*(\w+)/.exec(rest)![1].toLowerCase();
      rest = rest.replace(/^\s*\w+/, '');
    }
    const at = lt.time ?? (part ? PART[part] : null) ?? DEFAULT_TIME;
    const action = cleanAction(rest);
    if (!action) return null;
    const when: Schedule = days
      ? { type: 'weekly', days, hour: at.hour, minute: at.minute }
      : { type: 'daily', hour: at.hour, minute: at.minute };
    return { ok: true, when, action };
  }
  // One-off: "at 3pm tomorrow check my to-dos", "tomorrow at 9 brief me", "tonight at 8 …"
  m =
    /^(?:at\s+(.+?)\s+(today|tonight|tomorrow)|(today|tonight|tomorrow)(?:\s+(?:morning|afternoon|evening))?\s+at\s+(\S+(?:\s?(?:am|pm))?)|at\s+(\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm)?))\b[,\s]+(.+)$/i.exec(
      t,
    );
  if (m) {
    const timeText = m[1] ?? m[4] ?? m[5];
    const dayWord = (m[2] ?? m[3] ?? '').toLowerCase();
    const tm = clockTime(`${timeText}${dayWord === 'tonight' ? ' pm' : ''}`);
    const action = cleanAction(m[6]);
    if (!tm || !action) return null;
    const d = new Date(now);
    d.setHours(tm.hour, tm.minute, 0, 0);
    if (dayWord === 'tomorrow') d.setDate(d.getDate() + 1);
    else if (!dayWord && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    if (d.getTime() <= now.getTime()) return { ok: false, reason: 'That time has already passed.' };
    return { ok: true, when: { type: 'once', at: d.getTime() }, action };
  }
  return null;
}

/** Words that start the action after a trigger with no comma ("when I get home remind me …"). */
const VERBS =
  '(?:remind|tell|give|say|read|text|message|email|turn|start|play|check|ask|show|list|open|summar\\w*|recap|brief|let|add|save|note|call|switch|set|put|send|reply|answer|warn|notify|ping|speak)';
const ENDS = `(?=[,.;:]|\\s+${VERBS}\\b|$)`;
const APPS =
  'whatsapp|telegram|signal|messages|sms|messenger|slack|teams|discord|gmail|email|instagram';

function parseTrigger(t: string): ParseResult {
  const m = /^(?:whenever|when(?:ever)?|each time|every time|any ?time|if)\s+(.+)$/i.exec(t);
  if (!m) {
    const b =
      /^(?:(\d+|five|ten|fifteen|thirty)\s+min(?:ute)?s?\s+)?before\s+(?:each|every|my|any)\s+(?:meeting|event|appointment)s?\b(.*)$/i.exec(
        t,
      );
    if (!b) return null;
    const W: Record<string, number> = { five: 5, ten: 10, fifteen: 15, thirty: 30 };
    const minutesBefore = b[1] ? (W[b[1].toLowerCase()] ?? parseInt(b[1], 10)) : 10;
    const action = cleanAction(b[2]);
    if (!action) return null;
    return { ok: true, when: { type: 'event', minutesBefore }, action };
  }
  const s = m[1];
  const rules: { re: RegExp; when: (r: RegExpExecArray) => Trigger }[] = [
    {
      // "Sam messages me", "Sam texts me on WhatsApp", "I get a message from Sam", "I get a WhatsApp"
      re: new RegExp(
        `^(?:i\\s+get\\s+(?:a\\s+|an\\s+)?(?:new\\s+)?(?:(${APPS})\\s+)?(?:message|text|email|whatsapp)(?:\\s+on\\s+(${APPS}))?(?:\\s+from\\s+([\\w' -]+?)(?=\\s+on\\s|[,.;:]|\\s+${VERBS}\\b|$))?(?:\\s+on\\s+(${APPS}))?|([\\w' -]+?)\\s+(?:messages|texts|emails|whatsapps|writes\\s+to|sends\\s+me\\s+a\\s+(?:message|text))(?:\\s+me)?(?:\\s+on\\s+(${APPS}))?)\\b`,
        'i',
      ),
      when: (r) => {
        const who = (r[3] ?? r[5] ?? '').trim();
        const app = (r[1] ?? r[2] ?? r[4] ?? r[6] ?? '').toLowerCase() || null;
        const anyone = !who || /^(anyone|someone|anybody|somebody|people|a person)$/i.test(who);
        return { type: 'message', who: anyone ? null : titleCase(who), app };
      },
    },
    {
      re: /^(?:i\s+(?:connect|plug\s+in|put\s+on|put)\s+(?:my\s+)?(?:headphones|earbuds|earphones|headset|buds)(?:\s+on|\s+in)?|(?:my\s+)?(?:headphones|earbuds|earphones|headset)\s+(?:are\s+|is\s+|get\s+)?(?:connected|connect|plugged\s+in|on|go\s+in))\b/i,
      when: () => ({ type: 'headphones' }),
    },
    {
      re: /^(?:i\s+(?:get|am|'m)\s+in(?:to)?\s+(?:the|my)\s+car|i'?m\s+in\s+the\s+car|i\s+(?:start\s+)?driv(?:e|ing)|(?:the|my)\s+car\s+connects|i\s+connect\s+to\s+(?:the|my)\s+car)\b/i,
      when: () => ({ type: 'car' }),
    },
    {
      re: /^(?:i\s+(?:start\s+charging|plug\s+(?:in\s+)?(?:my\s+)?(?:phone\s*)?(?:in)?|put\s+(?:my\s+|the\s+)?phone\s+on\s+(?:charge|the\s+charger))|(?:my\s+|the\s+)?phone\s+(?:is\s+|starts\s+)?charging|it'?s\s+charging)\b/i,
      when: () => ({ type: 'charging' }),
    },
    {
      re: /^(?:i\s+(?:first\s+)?unlock\s+(?:my|the)\s+phone(?:\s+(?:for\s+the\s+first\s+time|each\s+day|in\s+the\s+morning|every\s+(?:day|morning)))?|i\s+wake\s+up|i\s+start\s+my\s+day)\b/i,
      when: () => ({ type: 'unlock' }),
    },
    {
      re: new RegExp(
        `^i\\s+(?:get|arrive|come|am|'m)\\s+(?:back\\s+)?(?:(?:to|at)\\s+(?:the\\s+)?([\\w' -]+?)|(home))${ENDS}`,
        'i',
      ),
      when: (r) => ({
        type: 'place',
        place: placeName(r[1] || r[2] || 'home'),
        edge: 'enter',
      }),
    },
    {
      re: new RegExp(`^i\\s+leave\\s+(?:the\\s+)?([\\w' -]+?)${ENDS}`, 'i'),
      when: (r) => ({ type: 'place', place: placeName(r[1]), edge: 'leave' }),
    },
    {
      re: /^(?:(?:a|my|each|every)\s+)?(?:meeting|event|appointment)\s+(?:is\s+about\s+to\s+start|starts|is\s+coming\s+up)(?:\s+soon)?\b/i,
      when: () => ({ type: 'event', minutesBefore: 10 }),
    },
  ];
  for (const rule of rules) {
    const r = rule.re.exec(s);
    if (!r) continue;
    const action = cleanAction(s.slice(r[0].length));
    if (!action) return { ok: false, reason: 'Say what I should do then, e.g. "…, read it out".' };
    return { ok: true, when: rule.when(r), action };
  }
  return null;
}

function placeName(s: string): string {
  const p = s
    .trim()
    .toLowerCase()
    .replace(/^(?:the|my)\s+/, '');
  if (!p || p === 'back home' || p === 'back') return 'home';
  return p;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Times ---

function at(day: Date, hour: number, minute: number): number {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/** The first scheduled time strictly after [after] (ms), or null (one-off already done). */
export function nextTime(
  r: Pick<Routine, 'when' | 'lastRunAt' | 'anchor' | 'createdAt'>,
  after: number,
): number | null {
  const w = r.when;
  switch (w.type) {
    case 'once':
      return r.lastRunAt == null && w.at > after ? w.at : null;
    case 'interval': {
      const step = w.everyMin * 60_000;
      const base = r.anchor ?? r.createdAt;
      const k = Math.floor((after - base) / step) + 1;
      return base + Math.max(1, k) * step;
    }
    case 'daily':
    case 'weekly': {
      const start = new Date(after);
      for (let i = 0; i <= 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        if (w.type === 'weekly' && !w.days.includes(d.getDay())) continue;
        const t = at(d, w.hour, w.minute);
        if (t > after) return t;
      }
      return null;
    }
    default:
      return null;
  }
}

/** The latest scheduled time at or before [now] that hasn't run yet, or null. */
export function dueTime(r: Routine, now: number): number | null {
  if (r.paused || !isSchedule(r.when)) return null;
  const from = Math.max(r.lastRunAt ?? r.createdAt, r.createdAt);
  let t = nextTime(r, from);
  let due: number | null = null;
  // Walk forward to the last missed time (at most a week of minutes for intervals).
  for (let i = 0; t != null && t <= now && i < 2000; i++) {
    due = t;
    t = nextTime(r, t);
  }
  return due;
}

export type DueRun = { routine: Routine; dueAt: number; late: boolean };

/** Routines to run now; misses older than LATE_LIMIT_MS are reported with skip = true. */
export function dueRoutines(list: Routine[], now: number): { run: DueRun[]; skip: DueRun[] } {
  const run: DueRun[] = [];
  const skip: DueRun[] = [];
  for (const r of list) {
    const d = dueTime(r, now);
    if (d == null) continue;
    const late = now - d > LATE_AFTER_MS;
    (now - d > LATE_LIMIT_MS ? skip : run).push({ routine: r, dueAt: d, late });
  }
  return { run: run.sort((a, b) => a.dueAt - b.dueAt), skip };
}

/** The next alarm per scheduled routine (for the native scheduler). */
export function upcoming(list: Routine[], now: number): { id: string; at: number }[] {
  return list
    .filter((r) => !r.paused && isSchedule(r.when))
    .map((r) => ({ id: r.id, at: nextTime(r, Math.max(now, r.lastRunAt ?? 0)) }))
    .filter((x): x is { id: string; at: number } => x.at != null)
    .sort((a, b) => a.at - b.at);
}

/** May a trigger routine run again now (not too soon after its last run; unlock once a day)? */
export function triggerAllowed(r: Routine, now: number): boolean {
  if (r.paused || isSchedule(r.when)) return false;
  if (r.lastRunAt == null) return true;
  if (r.when.type === 'unlock') {
    const d = new Date(now);
    return r.lastRunAt < new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  const gap = r.when.type === 'message' ? MESSAGE_GAP_MS : TRIGGER_GAP_MS;
  return now - r.lastRunAt >= gap;
}

/** Does a message notification match this routine's trigger? */
export function messageMatches(
  t: Extract<Trigger, { type: 'message' }>,
  m: { title: string | null; app: string | null; pkg: string | null },
): boolean {
  const norm = (s: string | null) => (s ?? '').toLowerCase();
  if (t.app) {
    const a =
      t.app === 'sms' || t.app === 'messages' ? 'messag' : t.app === 'email' ? 'mail' : t.app;
    if (!norm(m.app).includes(a) && !norm(m.pkg).includes(a.replace(/\s/g, ''))) return false;
  }
  if (t.who) {
    const first = t.who.toLowerCase().split(/\s+/)[0];
    if (!new RegExp(`\\b${escapeRe(first)}\\b`).test(norm(m.title))) return false;
  }
  return true;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Words ---

function clock(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "Every day at 18:00", "Weekdays at 08:00", "When Sam messages you". */
export function describeWhen(w: When, now = new Date()): string {
  switch (w.type) {
    case 'daily':
      return `Every day at ${clock(w.hour, w.minute)}`;
    case 'weekly': {
      const d = [...w.days].sort();
      const days =
        d.join() === '1,2,3,4,5'
          ? 'Weekdays'
          : d.join() === '0,6'
            ? 'Weekends'
            : d.length === 1
              ? `Every ${DAYS[d[0]][0].toUpperCase()}${DAYS[d[0]].slice(1)}`
              : d.map((x) => DAY_SHORT[x]).join(', ');
      return `${days} at ${clock(w.hour, w.minute)}`;
    }
    case 'once': {
      const d = new Date(w.at);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const day =
        w.at < today + 86_400_000
          ? 'Today'
          : w.at < today + 2 * 86_400_000
            ? 'Tomorrow'
            : d.toDateString().slice(0, 10);
      return `${day} at ${clock(d.getHours(), d.getMinutes())}`;
    }
    case 'interval':
      return w.everyMin % 60 === 0
        ? `Every ${w.everyMin === 60 ? 'hour' : `${w.everyMin / 60} hours`}`
        : `Every ${w.everyMin} minutes`;
    case 'message':
      return `When ${w.who ?? 'anyone'} messages you${w.app ? ` on ${appLabel(w.app)}` : ''}`;
    case 'event':
      return `${w.minutesBefore} min before each calendar event`;
    case 'headphones':
      return 'When headphones connect';
    case 'car':
      return 'When the car connects';
    case 'charging':
      return 'When the phone starts charging';
    case 'unlock':
      return 'First unlock of the day';
    case 'place':
      return `When you ${w.edge === 'enter' ? 'arrive at' : 'leave'} ${w.place}`;
  }
}

function appLabel(a: string): string {
  const L: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'Messages', email: 'email' };
  return L[a] ?? a.charAt(0).toUpperCase() + a.slice(1);
}

/** The reply after setting one up. */
export function confirmation(r: Pick<Routine, 'when' | 'action'>, now = new Date()): string {
  const w = describeWhen(r.when, now);
  return `OK. ${w}, I'll: ${r.action}. Change or pause it in Settings → Assistant → Routines.`;
}

/** "Brief me" and friends: the built-in briefing, no model needed. */
export function isBriefing(action: string): boolean {
  return /^(?:(?:give\s+me|read\s+me|tell\s+me|do)\s+)?(?:a\s+|my\s+|the\s+)?(?:daily\s+|morning\s+)?brief(?:ing)?(?:\s+me)?(?:\s+(?:for|on)\s+(?:the|my)\s+day)?$/i.test(
    action.trim(),
  );
}

/** "Read it out", "tell me", "say it": the message itself, spoken, no model needed. */
export function isReadOut(action: string): boolean {
  return /^(?:read|say|tell|speak)\s+(?:it|them|that|the\s+message|me)(?:\s+(?:out|aloud|out\s+loud|to\s+me))?$/i.test(
    action.trim(),
  );
}

export type TriggerContext =
  | { type: 'message'; who: string | null; app: string | null; text: string | null }
  | { type: 'event'; title: string; start: number }
  | { type: 'place'; place: string; edge: 'enter' | 'leave' }
  | { type: 'headphones' | 'car' | 'charging' | 'unlock' | 'time' };

/** The question run for this routine (plain instruction for times; context for triggers). */
export function routineQuestion(action: string, ctx: TriggerContext, now: Date): string {
  switch (ctx.type) {
    case 'message': {
      const from = [ctx.who, ctx.app && `on ${ctx.app}`].filter(Boolean).join(' ');
      return `A message${from ? ` from ${from}` : ''} just arrived: "${(ctx.text ?? '').slice(0, 500)}". ${action}`;
    }
    case 'event': {
      const mins = Math.max(0, Math.round((ctx.start - now.getTime()) / 60_000));
      return `"${ctx.title}" starts in ${mins} minutes. ${action}`;
    }
    case 'place':
      return `I just ${ctx.edge === 'enter' ? 'arrived at' : 'left'} ${ctx.place}. ${action}`;
    default:
      return action;
  }
}

/** Spoken / shown text for "read it out" on a message. */
export function readOutText(ctx: Extract<TriggerContext, { type: 'message' }>): string {
  const who = ctx.who ?? 'Someone';
  return `${who}${ctx.app ? ` on ${ctx.app}` : ''} says: ${(ctx.text ?? '').trim() || '(no text)'}`;
}

/** Model routines wait on low battery (unless charging) and in battery saver. */
export function batteryAllows(b: {
  batteryLevel: number;
  charging: boolean;
  lowPowerMode: boolean;
}): boolean {
  if (b.charging) return true;
  if (b.lowPowerMode) return false;
  return b.batteryLevel < 0 || b.batteryLevel >= 0.15;
}

/** "(Late: was due at 18:00, the phone was asleep.)" */
export function lateNote(dueAt: number, reason = 'the phone was busy or asleep'): string {
  const d = new Date(dueAt);
  return `(Late: this was due at ${clock(d.getHours(), d.getMinutes())}; ${reason}.)`;
}

/** Short label for the notification / chat bubble. */
export function routineLabel(r: Pick<Routine, 'action'>): string {
  const a = r.action.trim();
  return a.length > 60 ? `${a.slice(0, 57)}…` : a.charAt(0).toUpperCase() + a.slice(1);
}

/** Builds a new routine (checks the limit and duplicates). */
export function newRoutine(
  list: Routine[],
  said: string,
  when: When,
  action: string,
  now: number,
  id = `r${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
): { ok: true; routine: Routine } | { ok: false; reason: string } {
  if (list.length >= MAX_ROUTINES)
    return { ok: false, reason: `You have ${MAX_ROUTINES} routines already; delete one first.` };
  const same = list.find(
    (r) =>
      JSON.stringify(r.when) === JSON.stringify(when) &&
      r.action.toLowerCase() === action.toLowerCase(),
  );
  if (same) return { ok: false, reason: 'That routine is already set up.' };
  return {
    ok: true,
    routine: {
      id,
      said,
      action,
      when,
      paused: false,
      createdAt: now,
      lastRunAt: null,
      anchor: now,
    },
  };
}

/** The old fixed daily briefing as a routine (migration and the suggested template). */
export function briefingRoutine(hour: number): { when: Schedule; action: string; said: string } {
  return {
    when: { type: 'daily', hour, minute: 0 },
    action: 'brief me',
    said: `Every day at ${clock(hour, 0)} brief me`,
  };
}

/** Suggested routines shown in Settings (one tap adds them). */
export const TEMPLATES: { said: string }[] = [
  { said: 'Every weekday at 8am brief me' },
  { said: 'Every evening at 6pm give me a recap of my day' },
  { said: 'Every Monday at 8am summarise last week and what is on my calendar this week' },
  { said: 'Whenever anyone messages me, read it out' },
  { said: '10 minutes before each meeting, tell me what it is and who I last talked to about it' },
];

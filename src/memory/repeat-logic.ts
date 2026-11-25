/**
 * Recurring reminders: "every Monday at 9", "every day at 8", "every weekday", "daily". Stored on
 * the follow-up as a short rule ('daily', 'weekdays', 'weekly:1' with 0 = Sunday … 6 = Saturday).
 * Pure; tested in __tests__/repeat-logic-test.ts.
 */
export type Repeat = 'daily' | 'weekdays' | `weekly:${number}`;

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** The repeat words in [q] and the rule, or null. */
export function parseRepeat(q: string): { repeat: Repeat; words: string } | null {
  let m: RegExpExecArray | null;
  if (
    (m = /\b(every (single )?day|each day|daily|every morning|every evening|every night)\b/i.exec(
      q,
    ))
  )
    return { repeat: 'daily', words: m[0] };
  if ((m = /\b(every (week ?day)|on weekdays|weekdays|each weekday)\b/i.exec(q)))
    return { repeat: 'weekdays', words: m[0] };
  if (
    (m = /\b(?:every|each|on) (sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/i.exec(
      q,
    )) ||
    (m = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s\b/i.exec(q))
  )
    return { repeat: `weekly:${DAYS.indexOf(m[1].toLowerCase())}`, words: m[0] };
  if ((m = /\b(every week|weekly)\b/i.exec(q))) return null; // needs a day: handled as a one-off
  return null;
}

export function isRepeat(s: unknown): s is Repeat {
  return s === 'daily' || s === 'weekdays' || (typeof s === 'string' && /^weekly:[0-6]$/.test(s));
}

/** The first time after [after] that matches [repeat], at [first]'s time of day. */
export function nextOccurrence(repeat: Repeat, first: number, after: number): number {
  const base = new Date(first);
  const h = base.getHours();
  const min = base.getMinutes();
  const a = new Date(after);
  for (let i = 0; i <= 8; i++) {
    const d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i, h, min);
    if (d.getTime() <= after) continue;
    const wd = d.getDay();
    if (repeat === 'daily') return d.getTime();
    if (repeat === 'weekdays' && wd >= 1 && wd <= 5) return d.getTime();
    if (repeat.startsWith('weekly:') && wd === Number(repeat.slice(7))) return d.getTime();
  }
  return after + 86_400_000; // unreachable for valid rules
}

/** "every day", "every weekday", "every Monday" for the reminder list and spoken replies. */
export function repeatLabel(r: Repeat): string {
  if (r === 'daily') return 'every day';
  if (r === 'weekdays') return 'every weekday';
  const d = DAYS[Number(r.slice(7))];
  return `every ${d.charAt(0).toUpperCase()}${d.slice(1)}`;
}

/**
 * expo-notifications repeating triggers: DAILY for 'daily', one WEEKLY per day otherwise
 * (weekday 1 = Sunday there).
 */
export function repeatTriggers(
  r: Repeat,
  at: number,
): (
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; weekday: number; hour: number; minute: number }
)[] {
  const d = new Date(at);
  const hour = d.getHours();
  const minute = d.getMinutes();
  if (r === 'daily') return [{ type: 'daily', hour, minute }];
  const days = r === 'weekdays' ? [1, 2, 3, 4, 5] : [Number(r.slice(7))];
  return days.map((wd) => ({ type: 'weekly', weekday: wd + 1, hour, minute }));
}

/**
 * Date and calendar facts worked out in code, not by the model: today's date and weekday, the
 * time, leap years, days in a month, days until a date or holiday, and the weekday of a date.
 * The small model gets these wrong ("a leap year has thirty-six days") and doesn't know today's
 * date at all. Pure; tested in __tests__/date-answers-test.ts.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthIndex = (s: string) =>
  MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3)));

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a: Date, b: Date) =>
  Math.round((midnight(b).getTime() - midnight(a).getTime()) / 86_400_000);

/** "Thursday 26 November 2026". */
export function longDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${title(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
}

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Fixed-date holidays: [month, day]. */
const HOLIDAYS: Record<string, [number, number]> = {
  'christmas eve': [11, 24],
  'christmas day': [11, 25],
  christmas: [11, 25],
  'boxing day': [11, 26],
  "new year's eve": [11, 31],
  'new years eve': [11, 31],
  "new year's day": [0, 1],
  'new years day': [0, 1],
  'new year': [0, 1],
  halloween: [9, 31],
  "valentine's day": [1, 14],
  'valentines day': [1, 14],
  'bonfire night': [10, 5],
  "st patrick's day": [2, 17],
  'st patricks day': [2, 17],
};
const HOLIDAY_RE = Object.keys(HOLIDAYS)
  .sort((a, b) => b.length - a.length)
  .map((h) => h.replace(/'/g, "'?"))
  .join('|');

/**
 * A date named in [s] ("christmas", "25 december", "march 3rd 2027", "christmas day next year"),
 * the next one on or after today unless a year is given. Null if none.
 */
function namedDate(s: string, now: Date): { date: Date; label: string; yearGiven: boolean } | null {
  let month = -1;
  let day = 0;
  let label = '';
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`\\b(${HOLIDAY_RE})\\b`).exec(s))) {
    const key = m[1].replace(/'/g, '');
    const hit = Object.entries(HOLIDAYS).find(([k]) => k.replace(/'/g, '') === key);
    if (hit) [month, day] = hit[1];
    label = title(hit ? hit[0] : m[1]).replace(/\b(day|eve|night)\b/g, (w) => w);
  } else if ((m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MONTH_RE}\\b`).exec(s))) {
    day = +m[1];
    month = monthIndex(m[2]);
  } else if ((m = new RegExp(`\\b${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(s))) {
    month = monthIndex(m[1]);
    day = +m[2];
  }
  if (month < 0 || day < 1 || day > 31) return null;
  const year = /\b(1[6-9]\d\d|2\d\d\d)\b/.exec(s);
  let y = year ? +year[1] : now.getFullYear();
  if (!year && /\bnext year\b/.test(s)) y += 1;
  if (!year && /\blast year\b/.test(s)) y -= 1;
  if (day > daysInMonth(y, month)) return null;
  let date = new Date(y, month, day);
  const thisYear = /\bthis year\b/.test(s);
  if (!year && !thisYear && !/\b(next|last) year\b/.test(s) && date < midnight(now))
    date = new Date(y + 1, month, day);
  if (!label) label = `${day} ${title(MONTHS[month])}`;
  return { date, label, yearGiven: !!year };
}

const clean = (q: string) =>
  ` ${q
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^(?:hey |ok |okay )?(?:sidekick,? )?(?:please )?(?:(?:can|could) you tell me )?/, '')
    .replace(/[?.!]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()} `;

/** The answer to a date or calendar question, or null when [question] isn't one. */
export function dateAnswer(question: string, now: Date = new Date()): string | null {
  const s = clean(question);
  if (s.length > 90) return null;
  let m: RegExpExecArray | null;

  // The time here ("what time is it?"); other cities are timeIn's.
  if (
    /^ (what(?:'s| is) the time|what time is it|tell me the time|the time|time)( now| right now| please)? $/.test(
      s,
    )
  )
    return `It's ${hhmm(now)}.`;

  // Today / tomorrow / yesterday.
  const rel = /\b(today|tomorrow|yesterday)\b/.exec(s)?.[1] ?? 'today';
  const shift = rel === 'tomorrow' ? 1 : rel === 'yesterday' ? -1 : 0;
  if (
    /^ (?:what|which)(?:'s| is| was)? (?:the )?(?:day|date|day of the week|day and date)(?: is| was| will)?(?: it)?(?: be)?(?: today| tomorrow| yesterday)?(?: now)? $/.test(
      s,
    ) ||
    /^ (?:what(?:'s| is| was) )?(?:today|tomorrow|yesterday)(?:'s date| date)? $/.test(s)
  ) {
    const d = new Date(now);
    d.setDate(d.getDate() + shift);
    const lead =
      rel === 'today' ? 'Today is' : rel === 'tomorrow' ? 'Tomorrow is' : 'Yesterday was';
    return `${lead} ${longDate(d)}.`;
  }
  if (/^ what (year|month) (is it|are we in|is this)( now)? $/.test(s)) {
    return /year/.test(s)
      ? `It's ${now.getFullYear()}.`
      : `It's ${title(MONTHS[now.getMonth()])} ${now.getFullYear()}.`;
  }

  // Leap years.
  if (/\bhow many days\b.*\b(in|does|has) an? leap year\b|\bdays (are )?in a leap year\b/.test(s))
    return 'A leap year has 366 days: February has 29 days instead of 28.';
  if (/^ how many days (are )?(there )?in a (normal |common |non-leap )?year $/.test(s))
    return `A normal year has 365 days; a leap year has 366. ${now.getFullYear()} ${isLeapYear(now.getFullYear()) ? 'is a leap year, with 366' : 'has 365'}.`;
  if ((m = /\bis (?:the year )?(\d{4}|this year|next year|last year) a leap year\b/.exec(s))) {
    const y = /^\d/.test(m[1])
      ? +m[1]
      : now.getFullYear() + (m[1] === 'next year' ? 1 : m[1] === 'last year' ? -1 : 0);
    return isLeapYear(y)
      ? `Yes, ${y} is a leap year: February ${y} has 29 days.`
      : `No, ${y} is not a leap year; ${'the next one is ' + nextLeap(y)}.`;
  }
  if (/\b(when is|what is|what's) the next leap year\b/.test(s))
    return `The next leap year is ${nextLeap(isLeapYear(now.getFullYear()) ? now.getFullYear() : now.getFullYear())}.`;

  if (/^ how many weeks (are )?(there )?in a year $/.test(s))
    return 'A year has 52 weeks and 1 day (2 days in a leap year).';
  if ((m = new RegExp(`^ (?:what|which) month (comes|is) (after|before) ${MONTH_RE} $`).exec(s))) {
    const i = (monthIndex(m[3]) + (m[2] === 'after' ? 1 : 11)) % 12;
    return `${title(MONTHS[i])}.`;
  }

  // Days in a month.
  if (
    (m = new RegExp(
      `^ how many days (?:are )?(?:there )?(?:in|does|has) ${MONTH_RE}(?: (\\d{4}|this year|next year))?(?: have| has)? $`,
    ).exec(s))
  ) {
    const mi = monthIndex(m[1]);
    const y = m[2] && /^\d/.test(m[2]) ? +m[2] : now.getFullYear() + (m[2] === 'next year' ? 1 : 0);
    const n = daysInMonth(y, mi);
    const yearly =
      mi === 1 && !m[2] ? ` (29 in a leap year; ${y} ${isLeapYear(y) ? 'is' : 'is not'} one)` : '';
    return `${title(MONTHS[mi])}${m[2] ? ` ${y}` : ''} has ${n} days${yearly}.`;
  }

  // Days until / since a date.
  if (
    (m =
      /^ (?:how many (?:days|sleeps)|how long) (?:is it |are there |is there )?(?:until|till|til|to|before) (.+) $/.exec(
        s,
      ))
  ) {
    const d = namedDate(m[1], now);
    if (!d) return null;
    const n = dayDiff(now, d.date);
    if (n === 0) return `${d.label} is today.`;
    const day = `${WEEKDAYS[d.date.getDay()]} ${d.date.getDate()} ${title(MONTHS[d.date.getMonth()])} ${d.date.getFullYear()}`;
    if (n < 0) return `${d.label} was ${-n} day${n === -1 ? '' : 's'} ago, on ${day}.`;
    return `${n} day${n === 1 ? '' : 's'} until ${d.label} (${day}).`;
  }
  if ((m = /^ how many days (?:ago was|since|has it been since) (.+) $/.exec(s))) {
    const d = namedDate(m[1].replace(/\bthis year\b/, ''), now);
    if (!d) return null;
    let date = d.date;
    if (!d.yearGiven && date > midnight(now))
      date = new Date(date.getFullYear() - 1, date.getMonth(), date.getDate());
    const n = dayDiff(date, now);
    return `${n} day${n === 1 ? '' : 's'} since ${d.label} (${longDate(date)}).`;
  }

  // The weekday of a date.
  if (
    (m =
      /^ (?:what|which) day(?: of the week)? (?:is|was|will be|does|did|falls?|will) (.+?)(?: (?:be|fall|fall on|on|land on))?(?: in)? $/.exec(
        s,
      )) ||
    (m = /^ (?:what|which) day(?: of the week)? (?:is|was) it on (.+) $/.exec(s))
  ) {
    const d = namedDate(m[1], now);
    if (!d) return null;
    const past = d.date < midnight(now);
    return `${d.label}${d.label.includes(String(d.date.getFullYear())) ? '' : ` ${d.date.getFullYear()}`} ${past ? 'was' : 'is'} a ${WEEKDAYS[d.date.getDay()]}.`;
  }
  if (
    (m =
      /^ (?:is|was|will) (.+?) (?:be )?(?:on )?an? (sunday|monday|tuesday|wednesday|thursday|friday|saturday) $/.exec(
        s,
      ))
  ) {
    const d = namedDate(m[1], now);
    if (!d) return null;
    const wd = WEEKDAYS[d.date.getDay()];
    const yes = wd.toLowerCase() === m[2];
    return `${yes ? 'Yes' : 'No'}, ${d.label} ${d.date.getFullYear()} is a ${wd}.`;
  }
  return null;
}

function nextLeap(y: number): number {
  let n = y + 1;
  while (!isLeapYear(n)) n++;
  return n;
}

/** Question words about dates and time: such questions get today's date in the prompt. */
const TIME_TALK =
  /\b(today|tonight|tomorrow|yesterday|date|day|days|week|weeks|weekend|month|months|year|years|ago|until|since|how long|how old|age|birthday|time|clock|morning|afternoon|evening|season|christmas|easter|holiday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|leap|calendar|deadline|due|next|last)\b/i;

/** "Now: Thursday 26 November 2026, 14:30." for prompts whose question needs it, else ''. */
export function nowLine(question: string, now: Date): string {
  return TIME_TALK.test(question) ? `Now: ${longDate(now)}, ${hhmm(now)}.\n` : '';
}

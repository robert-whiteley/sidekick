/**
 * Time ranges said in plain words ("last 2 hours", "yesterday afternoon", "last Tuesday",
 * "between 2 and 4 yesterday", "since I got up", "in March"…), for recall, search and recaps.
 * Pure; tested in __tests__/time-range-test.ts.
 *
 * `to` may lie in the future (the end of "today"); callers that summarise clip it to now.
 */

export type TimeRange = { from: number; to: number; label: string };

export type RangeOptions = {
  /** When the owner's day started (first thing heard today); "since I got up". Default 06:00. */
  wakeAt?: number | null;
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
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
const MONTH_RE = `(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
// Full names only: "the sun", "wed" are not days.
const WEEKDAY_RE = `(sunday|monday|tuesday|wednesday|thursday|friday|saturday)`;
// Month names alone (no digits): full names only ("this may be", "mar").
const MONTH_FULL_RE = `(january|february|march|april|may|june|july|august|september|october|november|december)`;
const PART_RE = `(morning|afternoon|evening|night|lunch(?:time)?)`;

const NUM_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  couple: 2,
  'a couple': 2,
  'couple of': 2,
  'a couple of': 2,
  few: 3,
  'a few': 3,
  several: 5,
};
const NUM = `(\\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|(?:a )?couple(?: of)?|(?:a )?few|several)`;
const UNIT = `(minute|min|hour|hr|day|week|month)s?`;
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  min: 60_000,
  hour: HOUR,
  hr: HOUR,
  day: DAY,
  week: 7 * DAY,
  month: 30 * DAY,
};

const num = (w: string) => NUM_WORDS[w.trim()] ?? Number(w);
const fuzzy = (w: string) => /couple|few|several/.test(w);

const monthIndex = (w: string) => MONTHS.findIndex((m) => m.startsWith(w.slice(0, 3)));
const weekdayIndex = (w: string) => WEEKDAYS.findIndex((d) => d.startsWith(w.slice(0, 3)));

/** Day parts: hours [from, to). */
const PARTS: Record<string, [number, number]> = {
  morning: [0, 12],
  lunch: [11.5, 14],
  lunchtime: [11.5, 14],
  afternoon: [12, 18],
  evening: [17, 24],
  night: [17, 29], // into the small hours of the next day
};

const two = (n: number) => String(n).padStart(2, '0');
const clock = (t: number) => {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};
const dayName = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

/** Hour of a spoken clock time: "2" → 14 (afternoon guess), "9" → 9, "2pm" → 14, "14:30" → 14.5. */
function clockHour(h: string, m: string | undefined, ampm: string | undefined): number | null {
  let hour = Number(h);
  const min = m ? Number(m) : 0;
  if (hour > 23 || min > 59) return null;
  const ap = ampm?.replace(/\./g, '').toLowerCase();
  if (ap === 'pm' && hour < 12) hour += 12;
  else if (ap === 'am' && hour === 12) hour = 0;
  else if (!ap && !m && hour >= 1 && hour <= 7) hour += 12; // "between 2 and 4" means afternoon
  return hour + min / 60;
}

/**
 * The time range named in [q], or null if it names none. Checked most specific first.
 */
export function parseTimeRange(
  q: string,
  nowDate: Date,
  opts: RangeOptions = {},
): TimeRange | null {
  const s = ` ${q
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[?!,.]+(\s|$)/g, ' ')} `.replace(/\s+/g, ' ');
  const now = nowDate.getTime();
  const day = (offset: number) => {
    const d = new Date(nowDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.getTime();
  };
  const at = (dayStart: number, h: number) => {
    // Hours via setHours so DST days stay right.
    const d = new Date(dayStart);
    d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    return d.getTime();
  };
  const part = (dayStart: number, p: string): [number, number] => {
    const [a, b] = PARTS[p.startsWith('lunch') ? 'lunch' : p];
    return [at(dayStart, a), at(dayStart, b)];
  };
  /** Start of the most recent [weekday] (today counts unless [strictlyPast]). */
  const lastWeekday = (w: number, strictlyPast: boolean) => {
    let back = (nowDate.getDay() - w + 7) % 7;
    if (back === 0 && strictlyPast) back = 7;
    return day(-back);
  };
  /** Which day a phrase is about, if it names one ("yesterday", "on Tuesday"); else today. */
  const namedDay = (): { start: number; label: string } | null => {
    if (/\byesterday\b/.test(s)) return { start: day(-1), label: 'yesterday' };
    if (/\btoday\b/.test(s)) return { start: day(0), label: 'today' };
    const w = new RegExp(`\\b(last |this |on )?${WEEKDAY_RE}\\b`).exec(s);
    if (w && !/\bweekend\b/.test(s)) {
      const start = lastWeekday(weekdayIndex(w[2]), w[1] === 'last ');
      return { start, label: `on ${dayName(start)}` };
    }
    return null;
  };

  // "between 2 and 4 (yesterday)", "from 9am to 11", "from 14:00 until 15:30"
  const between = new RegExp(
    `\\b(?:between|from) (\\d{1,2})(?:[:.](\\d{2}))? ?(am|pm|a\\.m\\.|p\\.m\\.)? (?:and|to|until|till|-) (\\d{1,2})(?:[:.](\\d{2}))? ?(am|pm|a\\.m\\.|p\\.m\\.)?(?: o'?clock)?\\b`,
  ).exec(s);
  if (between) {
    const endAp = between[6];
    const a = clockHour(between[1], between[2], between[3] ?? (endAp === 'pm' ? 'pm' : undefined));
    const b = clockHour(between[4], between[5], endAp);
    if (a != null && b != null) {
      const d = namedDay() ?? { start: day(0), label: '' };
      let from = at(d.start, a);
      let to = at(d.start, b <= a ? b + 12 : b);
      // Today, still ahead: they meant yesterday.
      if (!d.label && from > now) [from, to] = [from - DAY, to - DAY];
      return {
        from,
        to,
        label: `between ${clock(from)} and ${clock(to)}${d.label ? ` ${d.label}` : ''}`,
      };
    }
  }

  // "since I got up / woke up", "since 9", "since 9am", "since 14:30", "since lunch", "since Monday"
  if (/\bsince (i (got up|woke( up)?|left( home)?)|this morning)\b/.test(s)) {
    const from = opts.wakeAt != null && opts.wakeAt >= day(0) ? opts.wakeAt : at(day(0), 6);
    return { from, to: now, label: `since ${clock(from)}` };
  }
  const sinceClock =
    /\bsince (\d{1,2})(?:[:.](\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?(?: o'?clock)?\b/.exec(s);
  if (sinceClock) {
    const h = clockHour(sinceClock[1], sinceClock[2], sinceClock[3]);
    if (h != null) {
      let from = at(day(0), h);
      // "since 2" said at 10:00 means 02:00, not 14:00.
      if (from > now && !sinceClock[3] && !sinceClock[2] && h >= 12) from = at(day(0), h - 12);
      if (from > now) from -= DAY;
      return { from, to: now, label: `since ${clock(from)}` };
    }
  }
  if (/\bsince lunch(time)?\b/.test(s)) {
    const from = at(day(0), 13);
    return { from: from > now ? from - DAY : from, to: now, label: 'since lunch' };
  }
  if (/\bsince yesterday\b/.test(s)) return { from: day(-1), to: now, label: 'since yesterday' };
  const sinceDay = new RegExp(`\\bsince (last )?${WEEKDAY_RE}\\b`).exec(s);
  if (sinceDay) {
    const from = lastWeekday(weekdayIndex(sinceDay[2]), true);
    return { from, to: now, label: `since ${dayName(from)}` };
  }

  // "5 minutes ago", "a couple of hours ago": a window around then that grows with n.
  // "3 days ago": that whole day.
  const ago = new RegExp(`\\b${NUM} ${UNIT} ago\\b`).exec(s);
  if (ago) {
    const n = num(ago[1]);
    const unit = UNIT_MS[ago[2]];
    if (unit >= DAY) {
      const days = Math.round((n * unit) / DAY);
      const spread = fuzzy(ago[1]) || unit > DAY ? Math.max(1, Math.round(days / 3)) : 0;
      return {
        from: day(-days - spread),
        to: day(-days + spread + 1),
        label: `${ago[1].trim()} ${ago[2]}${n === 1 ? '' : 's'} ago`,
      };
    }
    const center = now - n * unit;
    // People round ("5 minutes ago" may mean 3 or 7), so the window grows with n.
    const half = Math.max(unit, (n * unit) / 2);
    return {
      from: center - half,
      to: Math.min(now, center + half),
      label: `about ${ago[1].trim()} ${ago[2]}${n === 1 ? '' : 's'} ago`,
    };
  }

  // "(in) the last 2 hours", "past 3 days", "last few hours", "the last half hour", "past hour"
  if (/\b(last|past) half (an )?hour\b/.test(s))
    return { from: now - HOUR / 2, to: now, label: 'in the last half hour' };
  const lastN = new RegExp(`\\b(?:last|past|previous) ${NUM} ${UNIT}\\b`).exec(s);
  if (lastN) {
    const n = num(lastN[1]);
    const u = lastN[2];
    return {
      from: now - n * UNIT_MS[u],
      to: now,
      label: `in the last ${n === 1 ? '' : `${lastN[1].trim()} `}${u}${n === 1 ? '' : 's'}`,
    };
  }
  const lastUnit = /\b(?:last|past) (minute|hour)\b/.exec(s);
  if (lastUnit)
    return { from: now - UNIT_MS[lastUnit[1]], to: now, label: `in the last ${lastUnit[1]}` };

  // "at 3pm (yesterday)", "around 14:30", "about 3 o'clock": ±30 minutes.
  const atClock =
    /\b(?:at|around|about) (\d{1,2})(?:(?:[:.](\d{2}))|(?: ?(am|pm|a\.m\.|p\.m\.))|( o'?clock))+\b/.exec(
      s,
    );
  if (atClock) {
    const h = clockHour(atClock[1], atClock[2], atClock[3]);
    if (h != null) {
      const d = namedDay() ?? { start: day(0), label: '' };
      let t = at(d.start, h);
      if (!d.label && t > now) t -= DAY;
      return {
        from: t - HOUR / 2,
        to: Math.min(t + HOUR / 2, now),
        label: `around ${clock(t)}${d.label ? ` ${d.label}` : ''}`,
      };
    }
  }

  // Parts of today and yesterday.
  if (/\bearlier( today| on)?\b/.test(s) && !/\b(yesterday|week|month|year|night)\b/.test(s))
    return { from: day(0), to: now, label: 'earlier today' };
  if (/\btoday so far\b/.test(s)) return { from: day(0), to: now, label: 'today' };
  const thisPart = new RegExp(`\\b(this|yesterday) ${PART_RE}\\b`).exec(s);
  if (thisPart) {
    const start = thisPart[1] === 'this' ? day(0) : day(-1);
    const [from, to] = part(start, thisPart[2]);
    return { from, to, label: `${thisPart[1]} ${thisPart[2]}` };
  }
  if (/\btonight\b/.test(s)) {
    const [from, to] = part(day(0), 'evening');
    return { from, to, label: 'tonight' };
  }
  if (/\blast night\b/.test(s))
    return { from: at(day(-1), 17), to: at(day(0), 5), label: 'last night' };
  if (/\btoday\b/.test(s)) return { from: day(0), to: day(1), label: 'today' };
  if (/\bday before yesterday\b/.test(s))
    return { from: day(-2), to: day(-1), label: 'the day before yesterday' };
  if (/\byesterday\b/.test(s)) return { from: day(-1), to: day(0), label: 'yesterday' };

  // Weekends: the most recent one that has started (this one, on a Saturday or Sunday).
  const weekend = /\b(over the|this|last|at the) weekend\b/.exec(s);
  if (weekend) {
    const dow = nowDate.getDay();
    const inWeekend = dow === 6 || dow === 0;
    let sat = day(-((dow + 1) % 7)); // most recent Saturday (today if Saturday)
    if (weekend[1] === 'last' && inWeekend) sat = day(-((dow + 1) % 7) - 7);
    return {
      from: sat,
      to: at(sat, 48),
      label: inWeekend && weekend[1] !== 'last' ? 'this weekend' : 'over the weekend',
    };
  }

  // Weekdays: "last Tuesday", "on Monday morning", "Friday".
  const wd = new RegExp(`\\b(last |this |on |)${WEEKDAY_RE}(?: ${PART_RE})?\\b`).exec(s);
  if (wd && !/\b(next|every|each|coming)\b/.test(s)) {
    const start = lastWeekday(weekdayIndex(wd[2]), wd[1] === 'last ');
    if (wd[3]) {
      const [from, to] = part(start, wd[3]);
      return { from, to, label: `on ${dayName(start)} ${wd[3]}` };
    }
    return { from: start, to: start + DAY, label: `on ${dayName(start)}` };
  }

  // Dates: "on 5 March", "March 5th", "the 5th of March", "on the 5th".
  const date =
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MONTH_RE}\\b`).exec(s) ??
    new RegExp(`\\b${MONTH_RE} (\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(s);
  if (date) {
    const [dd, mm] = /^\d/.test(date[1]) ? [Number(date[1]), date[2]] : [Number(date[2]), date[1]];
    const m = monthIndex(mm);
    if (m >= 0 && dd >= 1 && dd <= 31) {
      let d = new Date(nowDate.getFullYear(), m, dd).getTime();
      if (d > now) d = new Date(nowDate.getFullYear() - 1, m, dd).getTime();
      return { from: d, to: at(d, 24), label: `on ${dayName(d)}` };
    }
  }
  const nth = /\bon the (\d{1,2})(?:st|nd|rd|th)\b/.exec(s);
  if (nth) {
    const dd = Number(nth[1]);
    let d = new Date(nowDate.getFullYear(), nowDate.getMonth(), dd).getTime();
    if (d > now) d = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, dd).getTime();
    return { from: d, to: at(d, 24), label: `on ${dayName(d)}` };
  }

  // Weeks, months, years.
  const monday = day(-((nowDate.getDay() + 6) % 7));
  if (/\bthis week\b/.test(s)) return { from: monday, to: day(1), label: 'this week' };
  if (/\blast week\b/.test(s)) return { from: monday - 7 * DAY, to: monday, label: 'last week' };
  const monthStart = (y: number, m: number) => new Date(y, m, 1).getTime();
  const y = nowDate.getFullYear();
  const mo = nowDate.getMonth();
  if (/\bthis month\b/.test(s)) return { from: monthStart(y, mo), to: day(1), label: 'this month' };
  if (/\blast month\b/.test(s))
    return { from: monthStart(y, mo - 1), to: monthStart(y, mo), label: 'last month' };
  const inMonth = new RegExp(`\\b(in|during|last|this) ${MONTH_FULL_RE}\\b`).exec(s);
  if (inMonth && !(inMonth[2] === 'may' && /\bmay (i|we|you|be|have)\b/.test(s))) {
    const m = monthIndex(inMonth[2]);
    const yr = m > mo || (inMonth[1] === 'last' && m === mo) ? y - 1 : y;
    return {
      from: monthStart(yr, m),
      to: Math.min(monthStart(yr, m + 1), day(1)),
      label: `in ${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)}`,
    };
  }
  if (/\bthis year\b/.test(s)) return { from: monthStart(y, 0), to: day(1), label: 'this year' };
  return null;
}

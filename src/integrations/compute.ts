/**
 * Exact work handed off by the model (tools-logic.ts: calculate, convert, date, time_in): the
 * model reads the request in any wording and passes structured arguments; code computes. Nothing
 * here reads the user's words. Pure; tested in __tests__/compute-test.ts.
 */
import { daysInMonth, isLeapYear, longDate } from './date-answers';
import {
  convertAmount,
  evaluateExpression,
  formatNumber,
  timeInZone,
  ZONES,
} from './quick-answers';

/** "17*23" → "17 × 23 is 391." Null when the expression isn't a sum. */
export function calculateTool(expression: string): string | null {
  const e = expression
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\*\*/g, '^')
    .trim();
  const v = evaluateExpression(e);
  if (v === null) return null;
  const shown = e.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\s+/g, ' ');
  return `${shown} is ${formatNumber(v)}.`;
}

/** A unit conversion, or null when the units are unknown or don't match. */
export function convertTool(amount: number, from: string, to: string): string | null {
  return convertAmount(amount, from.trim().toLowerCase(), to.trim().toLowerCase());
}

/** The time now in [place], or null when the place isn't known. */
export function timeInTool(place: string, now: Date): string | null {
  const p = place.trim().toLowerCase().replace(/^the /, '');
  return ZONES[p] ? timeInZone(p, now) : null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a: Date, b: Date) =>
  Math.round((midnight(b).getTime() - midnight(a).getTime()) / 86_400_000);

function isoDate(s: unknown): Date | null {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim()) : null;
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}

export type DateArgs = {
  ask: string;
  date?: string;
  days?: number;
  year?: number;
  month?: number;
};

/** Calendar facts from structured arguments, relative to [now]. Null when arguments are missing. */
export function dateTool(a: DateArgs, now: Date): string | null {
  const date = isoDate(a.date);
  const year = a.year ?? date?.getFullYear() ?? now.getFullYear();
  switch (a.ask) {
    case 'today':
      return `Today is ${longDate(now)}.`;
    case 'weekday':
      return date
        ? `${longDate(date).replace(/^\w+ /, '')} is a ${WEEKDAYS[date.getDay()]}.`
        : null;
    case 'days_until': {
      if (!date) return null;
      const n = dayDiff(now, date);
      if (n === 0) return `That's today, ${longDate(now)}.`;
      if (n < 0) return `${longDate(date)} was ${-n} day${n === -1 ? '' : 's'} ago.`;
      return `${n} day${n === 1 ? '' : 's'} until ${longDate(date)}.`;
    }
    case 'days_since': {
      if (!date) return null;
      const n = dayDiff(date, now);
      if (n < 0) return `${longDate(date)} is in ${-n} day${n === -1 ? '' : 's'}.`;
      return `${n} day${n === 1 ? '' : 's'} since ${longDate(date)}.`;
    }
    case 'add_days': {
      if (a.days === undefined) return null;
      const from = date ?? midnight(now);
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + a.days);
      return `That's ${longDate(d)}.`;
    }
    case 'leap_year':
      return isLeapYear(year)
        ? `Yes, ${year} is a leap year: February has 29 days and the year 366.`
        : `No, ${year} is not a leap year: February has 28 days and the year 365.`;
    case 'days_in_month': {
      const m = a.month ? a.month - 1 : (date?.getMonth() ?? now.getMonth());
      return `${MONTHS[m]} ${year} has ${daysInMonth(year, m)} days.`;
    }
    default:
      return null;
  }
}

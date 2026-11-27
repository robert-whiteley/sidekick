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
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** "Thursday 26 November 2026". */
export function longDate(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${title(MONTHS[d.getMonth()])} ${d.getFullYear()}`;
}

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "Now: Thursday 26 November 2026, 14:30." for every question (the model knows no date). */
export function nowLine(now: Date): string {
  return `Now: ${longDate(now)}, ${hhmm(now)}.\n`;
}

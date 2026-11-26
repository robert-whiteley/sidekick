import { daysInMonth, isLeapYear, longDate, nowLine } from '@/integrations/date-answers';

// Thursday 26 November 2026, 14:30 local.
const NOW = new Date(2026, 10, 26, 14, 30);

test('leap years and month lengths', () => {
  expect(isLeapYear(2028)).toBe(true);
  expect(isLeapYear(1900)).toBe(false);
  expect(isLeapYear(2000)).toBe(true);
  expect(daysInMonth(2028, 1)).toBe(29);
  expect(daysInMonth(2026, 3)).toBe(30);
});

test('the now line for every question', () => {
  expect(longDate(NOW)).toBe('Thursday 26 November 2026');
  expect(nowLine(NOW)).toBe('Now: Thursday 26 November 2026, 14:30.\n');
});

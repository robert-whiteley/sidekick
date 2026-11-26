import { CASES } from '../bench/answers/cases';
import { scoreAnswer } from '@/engine/answers-bench-logic';
import { dateAnswer, isLeapYear, longDate, nowLine } from '@/integrations/date-answers';

// Thursday 26 November 2026, 14:30 local.
const NOW = new Date(2026, 10, 26, 14, 30);
const a = (q: string) => dateAnswer(q, NOW);

test('leap years', () => {
  expect(isLeapYear(2028)).toBe(true);
  expect(isLeapYear(1900)).toBe(false);
  expect(isLeapYear(2000)).toBe(true);
  expect(a('How many days are in a leap year?')).toMatch(/366/);
  expect(a('How many days does a leap year have?')).toMatch(/366/);
  expect(a('Is 2028 a leap year?')).toMatch(/^Yes/);
  expect(a('Is 2026 a leap year?')).toMatch(/^No.*2028/);
  expect(a('Is next year a leap year?')).toMatch(/^No, 2027/);
});

test('today, tomorrow, yesterday', () => {
  expect(a('What day is it today?')).toBe('Today is Thursday 26 November 2026.');
  expect(a("What's the date today?")).toMatch(/26 November 2026/);
  expect(a("What is today's date?")).toMatch(/26 November 2026/);
  expect(a('What day is it tomorrow?')).toBe('Tomorrow is Friday 27 November 2026.');
  expect(a('What day was it yesterday?')).toBe('Yesterday was Wednesday 25 November 2026.');
  expect(a('What year is it?')).toBe("It's 2026.");
  expect(a('What month is it?')).toBe("It's November 2026.");
  expect(a('What time is it?')).toBe("It's 14:30.");
});

test('days in a month', () => {
  expect(a('How many days are in February 2028?')).toMatch(/29 days/);
  expect(a('How many days in February?')).toMatch(/28 days.*29 in a leap year/);
  expect(a('How many days does April have?')).toMatch(/30 days/);
});

test('days until and since', () => {
  expect(a('How many days until Christmas?')).toMatch(
    /^29 days until Christmas.*Friday 25 December 2026/,
  );
  expect(a('How many days until New Year?')).toMatch(/^36 days/);
  expect(a('How many days until Halloween?')).toMatch(/Sunday 31 October 2027/);
  expect(a('How many days until 1 December?')).toMatch(/^5 days/);
  expect(a('How many days since Halloween?')).toMatch(/^26 days/);
  expect(a('How many days until my birthday?')).toBeNull();
});

test('weekday of a date', () => {
  expect(a('What day of the week is Christmas?')).toMatch(/Friday/);
  expect(a('What day of the week was 1 January 2000?')).toMatch(/was a Saturday/);
  expect(a('What day is 4 July 2027?')).toMatch(/Sunday/);
  expect(a('Is Christmas on a Friday?')).toMatch(/^Yes/);
});

test('not date questions', () => {
  expect(a('What day should I go to the gym?')).toBeNull();
  expect(a('Tell me about leap years in history and why they exist')).toBeNull();
  expect(a('Set a timer for 5 minutes')).toBeNull();
  expect(a('What did Priya say today?')).toBeNull();
});

test('every date case in the answers bench gets a computed answer that passes its check', () => {
  for (const c of CASES.filter((x) => x.cat === 'dates')) {
    const got = a(c.q);
    expect([c.id, got, got !== null && scoreAnswer(c, got, NOW)]).toEqual([c.id, got, true]);
  }
});

test('now line only for time-worded questions', () => {
  expect(longDate(NOW)).toBe('Thursday 26 November 2026');
  expect(nowLine('How many weeks until summer?', NOW)).toMatch(
    /^Now: Thursday 26 November 2026, 14:30/,
  );
  expect(nowLine('What is the capital of France?', NOW)).toBe('');
});

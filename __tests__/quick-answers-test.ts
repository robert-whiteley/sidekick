import {
  calculate,
  convertUnits,
  formatNumber,
  quickAnswer,
  timeIn,
} from '@/integrations/quick-answers';

test('sums are worked out exactly', () => {
  expect(calculate("what's 12 times 7")).toBe('84');
  expect(calculate('15% of 80')).toBe('12');
  expect(calculate('what is 2 + 3 * 4?')).toBe('14');
  expect(calculate('(2+3)*4')).toBe('20');
  expect(calculate('square root of 81')).toBe('9');
  expect(calculate('2 to the power of 10')).toBe('1,024');
  expect(calculate('100 divided by 8')).toBe('12.5');
  expect(calculate('1 / 3')).toBe('0.333333');
  expect(calculate('1,200 minus 45')).toBe('1,155');
  expect(calculate('5 divided by 0')).toBeNull();
});

test('ordinary questions are not sums', () => {
  expect(calculate('what is the weather')).toBeNull();
  expect(calculate("what's covid-19")).toBeNull();
  expect(calculate('what is 2024')).toBeNull();
  expect(calculate('what did Sam say at 3')).toBeNull();
});

test('units convert', () => {
  expect(convertUnits('convert 5 miles to km')).toBe('5 miles is 8.04672 kilometres.');
  expect(convertUnits('how many grams in a pound')).toBe('1 pound is 453.592 grams.');
  expect(convertUnits('100 f in c')).toBe('100°F is 37.8°C.');
  expect(convertUnits('what is 20 degrees celsius in fahrenheit')).toBe('20°C is 68°F.');
  expect(convertUnits('10 kg in stone')).toBe('10 kilograms is 1.57473 stone.');
  expect(convertUnits('5 miles in kg')).toBeNull();
  expect(convertUnits('put the kettle on in the kitchen')).toBeNull();
});

test('time in another city', () => {
  // 12:00 UTC on a winter Wednesday.
  const now = new Date(Date.UTC(2026, 0, 14, 12, 0));
  const a = timeIn('what time is it in Tokyo?', now)!;
  expect(a).toMatch(/^It's 21:00 in Tokyo, /);
  expect(timeIn('time in New York', now)).toMatch(/^It's 07:00 in New York/);
  expect(timeIn('what time is it in Narnia', now)).toBeNull();
  expect(timeIn('what time is my meeting', now)).toBeNull();
});

test('quickAnswer tries each and formats numbers', () => {
  expect(quickAnswer('what is 3 plus 4')).toBe('7');
  expect(formatNumber(1234567.891)).toBe('1,234,568');
  expect(formatNumber(0.5)).toBe('0.5');
});

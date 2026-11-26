import { calculate, convertAmount, formatNumber, timeInZone } from '@/integrations/quick-answers';

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

test('ordinary words are not sums', () => {
  expect(calculate('what is the weather')).toBeNull();
  expect(calculate("what's covid-19")).toBeNull();
  expect(calculate('what is 2024')).toBeNull();
});

test('units convert', () => {
  expect(convertAmount(5, 'miles', 'km')).toMatch(/8\.04672 kilometres/);
  expect(convertAmount(1, 'pound', 'grams')).toMatch(/453\.592 grams/);
  expect(convertAmount(20, 'celsius', 'fahrenheit')).toMatch(/68°F/);
  expect(convertAmount(5, 'miles', 'kg')).toBeNull();
});

test('time in another city', () => {
  // 12:00 UTC on a winter Wednesday.
  const now = new Date(Date.UTC(2026, 0, 14, 12, 0));
  expect(timeInZone('tokyo', now)).toMatch(/21:00/);
  expect(timeInZone('new york', now)).toMatch(/07:00/);
  expect(timeInZone('narnia', now)).toBeNull();
});

test('numbers are formatted', () => {
  expect(formatNumber(1234567.891)).toBe('1,234,568');
  expect(formatNumber(0.5)).toBe('0.5');
});

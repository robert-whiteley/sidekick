import { choiceChips, daysLabel, hoursLabel } from '@/features/settings/choice-logic';

const opts = [
  { value: 0.5, label: '0.5' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
];

test('null follows Recommended; picking Recommended stores null', () => {
  const chips = choiceChips(opts, null, 1);
  expect(chips.map((c) => c.label)).toEqual(['0.5', '1 (Recommended)', '2']);
  expect(chips.find((c) => c.selected)!.value).toBe(1);
  expect(chips[1].store).toBeNull();
  expect(chips[2].store).toBe(2);
});

test('override is selected; Recommended missing from options is added', () => {
  const chips = choiceChips(opts, 2, 3);
  expect(chips.find((c) => c.selected)!.value).toBe(2);
  expect(chips[3]).toMatchObject({ value: 3, recommended: true, store: null });
});

test('labels', () => {
  expect(hoursLabel(6)).toBe('6 hours');
  expect(hoursLabel(72)).toBe('3 days');
  expect(hoursLabel(720)).toBe('1 month');
  expect(daysLabel(0)).toBe('Forever');
  expect(daysLabel(90)).toBe('3 months');
});

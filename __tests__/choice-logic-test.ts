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

test('a Recommended value between the choices gets a labelled chip in order', () => {
  const opts = [1, 2, 4, 8, 16].map((g) => ({ value: g, label: `${g} GB` }));
  const chips = choiceChips(opts, null, 11, (g) => `${g} GB`);
  expect(chips.map((c) => c.label)).toEqual([
    '1 GB',
    '2 GB',
    '4 GB',
    '8 GB',
    '11 GB (Recommended)',
    '16 GB',
  ]);
  expect(chips.find((c) => c.selected)?.value).toBe(11);
});

test('camera moments are labelled Camera, not a speaker', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { who } = require('@/features/memory/timeline-logic');
  expect(who({ kind: 'frame', speakerName: null, speakerId: null })).toBe('Camera');
});

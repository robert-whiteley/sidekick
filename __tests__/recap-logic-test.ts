import {
  findStretch,
  RECAP_BUDGET,
  recapPrompt,
  relatedIds,
  spanLabel,
  withoutTimeWords,
} from '@/memory/recap-logic';

const NOW = new Date(2026, 10, 25, 15, 0); // Wednesday
const t = NOW.getTime();
const MIN = 60_000;

test('topics leave out time words and empty words', () => {
  expect(withoutTimeWords('the budget in the last 2 hours')).toBe('the budget');
  expect(withoutTimeWords('what did I see 5 minutes ago')).toBe('what did I see');
});

test('stretch: related moments joined across small gaps, ends at a long one', () => {
  const at = (minAgo: number, related = true) => ({ at: t - minAgo * MIN, related });
  const items = [at(0), at(20), at(25, false), at(50), at(200), at(210)];
  expect(findStretch(items, { gapMs: 45 * MIN, maxMs: 12 * 60 * MIN })).toEqual({
    from: t - 50 * MIN,
    to: t,
  });
  // Capped by the longest look-back.
  expect(findStretch(items, { gapMs: 999 * MIN, maxMs: 100 * MIN })!.from).toBe(t - 50 * MIN);
  expect(findStretch([at(5, false)], { gapMs: MIN, maxMs: MIN })).toBeNull();
});

test('related moments: close to the best match', () => {
  const ids = relatedIds(
    new Map([
      [1, 0.2],
      [2, 0.35],
      [3, 0.5],
      [4, 0.9],
    ]),
  );
  expect([...ids].sort()).toEqual([1, 2]);
  expect(relatedIds(new Map([[1, 0.8]])).size).toBe(0);
});

test('prompt: notes first, lines spread over the span, within budget', () => {
  const span = { from: t - 60 * MIN, to: t };
  expect(recapPrompt('today', null, span, [], [])).toBeNull();
  const lines = Array.from({ length: 2000 }, (_, i) => ({
    at: span.from + i * 1000,
    who: 'Me',
    text: `line ${i} ${'x'.repeat(100)}`,
  }));
  const p = recapPrompt(
    'today',
    'budget',
    span,
    [{ at: t - 30 * MIN, text: 'Conversation with Sam\nBudget agreed' }],
    lines,
    {
      places: ['Leeds, GB'],
    },
  )!;
  expect(p.indexOf('Budget agreed')).toBeLessThan(p.indexOf('line 0'));
  expect(p).toContain('Places: Leeds, GB');
  expect(p).toContain('line 1999'); // the end, not just the start
  expect(p.length).toBeLessThan(RECAP_BUDGET + 600);
  expect(p).toContain('Recap today about budget');
});

test('span labels', () => {
  expect(spanLabel(new Date(2026, 10, 25, 14, 10).getTime(), t, t)).toBe('since 14:10');
  expect(
    spanLabel(new Date(2026, 10, 24, 9, 0).getTime(), new Date(2026, 10, 24, 11, 0).getTime(), t),
  ).toBe('on Tuesday, 09:00–11:00');
});

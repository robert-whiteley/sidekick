import { AckPolicy, MAX_TAKE_TRIES, takeJournal } from '../src/memory/journal-take';

test('new builds keep the lines until they are acked', () => {
  const acked: number[] = [];
  const t = takeJournal({
    journalDrain: () => ['old way'],
    journalTake: () => ({ lines: ['a', 'b'], replayed: 1 }),
    journalAck: () => acked.push(1),
  });
  expect(t.lines).toEqual(['a', 'b']);
  expect(t.replayed).toBe(1);
  expect(acked).toEqual([]);
  t.ack();
  expect(acked).toEqual([1]);
});

test('older builds fall back to the read-and-clear drain', () => {
  const t = takeJournal({ journalDrain: () => ['x'] });
  expect(t).toMatchObject({ lines: ['x'], replayed: 0 });
  expect(() => t.ack()).not.toThrow();
});

test('a batch that failed is kept for another try, but never blocks the journal forever', () => {
  const p = new AckPolicy();
  expect(p.done(false)).toBe(true);
  for (let i = 1; i < MAX_TAKE_TRIES; i++) expect(p.done(true)).toBe(false);
  expect(p.done(true)).toBe(true);
  // A good batch resets the count.
  expect(p.done(true)).toBe(false);
  expect(p.done(false)).toBe(true);
  expect(p.done(true)).toBe(false);
});

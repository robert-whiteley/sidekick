import { lockAfterLabel, lockAvailable, needsUnlock } from '@/engine/app-lock-logic';

test('the app lock asks on open and after time away', () => {
  const base = { enabled: true, now: 10 * 60_000, afterMin: null };
  expect(needsUnlock({ ...base, enabled: false, leftAt: null })).toBe(false);
  expect(needsUnlock({ ...base, leftAt: null })).toBe(true);
  expect(needsUnlock({ ...base, leftAt: base.now - 30_000 })).toBe(false);
  expect(needsUnlock({ ...base, leftAt: base.now - 60_000 })).toBe(true);
  expect(needsUnlock({ ...base, afterMin: 0, leftAt: base.now - 1 })).toBe(true);
  expect(needsUnlock({ ...base, afterMin: 5, leftAt: base.now - 4 * 60_000 })).toBe(false);
});

test('needs a phone screen lock', () => {
  expect(lockAvailable(0)).toBe(false);
  expect(lockAvailable(1)).toBe(true);
  expect(lockAfterLabel(0)).toBe('Every time');
});

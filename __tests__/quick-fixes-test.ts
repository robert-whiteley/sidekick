import { QUICK_FIX_EVERY_MS, quickFixCheckDue } from '../src/engine/quick-fixes-logic';

const base = { enabled: true, updatesEnabled: true, wifi: true, lastCheckAt: null, now: 1e12 };

test('checks on Wi-Fi when switched on and never checked', () => {
  expect(quickFixCheckDue(base)).toBe(true);
});

test('never checks when the switch is off, off Wi-Fi, or updates are disabled in the build', () => {
  expect(quickFixCheckDue({ ...base, enabled: false })).toBe(false);
  expect(quickFixCheckDue({ ...base, wifi: false })).toBe(false);
  expect(quickFixCheckDue({ ...base, updatesEnabled: false })).toBe(false);
});

test('at most once every 6 hours', () => {
  expect(quickFixCheckDue({ ...base, lastCheckAt: base.now - QUICK_FIX_EVERY_MS + 1 })).toBe(false);
  expect(quickFixCheckDue({ ...base, lastCheckAt: base.now - QUICK_FIX_EVERY_MS })).toBe(true);
});

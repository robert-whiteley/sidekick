import { firstRunStep, introMessage } from '@/features/onboarding/first-run';

const base = {
  neededBytes: 4e9,
  freeBytes: 50e9,
  reserveBytes: 5e9,
  wifi: true,
  mobilePref: 'ask' as const,
  mobileAllowed: false,
};

test('not enough space: says how much more is needed', () => {
  expect(firstRunStep({ ...base, freeBytes: 6e9 })).toEqual({ step: 'short-space', shortBy: 3e9 });
});

test('on Wi-Fi it just downloads (staying on Wi-Fi)', () => {
  expect(firstRunStep(base)).toEqual({ step: 'download', wifiOnly: true });
});

test('on mobile data it asks, while queued for Wi-Fi', () => {
  expect(firstRunStep({ ...base, wifi: false })).toEqual({ step: 'ask-mobile', wifiOnly: true });
});

test('mobile data allowed (now, or by setting) downloads on any network', () => {
  expect(firstRunStep({ ...base, wifi: false, mobileAllowed: true })).toEqual({
    step: 'download',
    wifiOnly: false,
  });
  expect(firstRunStep({ ...base, wifi: false, mobilePref: 'auto' })).toEqual({
    step: 'download',
    wifiOnly: false,
  });
});

test('mobile data off: waits for Wi-Fi without asking', () => {
  expect(firstRunStep({ ...base, wifi: false, mobilePref: 'off' })).toEqual({
    step: 'download',
    wifiOnly: true,
  });
});

test('intro message offers three things to try', () => {
  expect(introMessage().tries).toHaveLength(3);
});

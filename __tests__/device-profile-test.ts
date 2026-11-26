import {
  type DeviceProfile,
  phoneFeatures,
  recommend,
  resolveTuning,
  speedTier,
} from '@/engine/device-profile';
import { DEFAULTS } from '@/engine/settings';

jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: { kvGet: () => null, kvSet: () => {} },
}));
jest.mock('expo-file-system', () => ({ Paths: { totalDiskSpace: 0, availableDiskSpace: 0 } }));

const GB = 1024 ** 3;
const phone = (p: Partial<DeviceProfile>): DeviceProfile => ({
  platform: 'android',
  osVersion: 34,
  manufacturer: 'Google',
  model: 'X',
  soc: '',
  ramMb: 8000,
  totalStorageBytes: 128 * GB,
  freeStorageBytes: 60 * GB,
  usbHost: true,
  thermalApi: true,
  measuredTokPerSec: null,
  measuredVoiceFirstSoundMs: null,
  ...p,
});

test('speed tier from chip, RAM and measured speed', () => {
  expect(speedTier(phone({ soc: 'QTI SM7250' }))).toBe('low'); // Pixel 5
  expect(speedTier(phone({ soc: 'Google Tensor G5' }))).toBe('high');
  expect(speedTier(phone({ soc: 'Qualcomm SM8850' }))).toBe('high'); // 8 Elite Gen 5
  expect(speedTier(phone({ soc: 'Google Tensor G2' }))).toBe('mid');
  expect(speedTier(phone({ soc: 'Google Tensor G5', ramMb: 4000 }))).toBe('low');
  // Measured speed overrides the chip guess.
  expect(speedTier(phone({ soc: 'QTI SM7250', measuredTokPerSec: 18 }))).toBe('high');
  expect(speedTier(phone({ soc: 'Google Tensor G5', measuredTokPerSec: 5 }))).toBe('low');
});

test('recommended values scale with the phone', () => {
  const pixel5 = recommend(phone({ soc: 'QTI SM7250' }));
  expect(pixel5).toMatchObject({ fps: 0.5, frameWindow: 2, imageDetail: 'low', voice: 'pocket' });
  expect(pixel5.modelTier).toBe('standard');
  const s26 = recommend(phone({ soc: 'Qualcomm SM8850', ramMb: 12000 }));
  expect(s26).toMatchObject({ fps: 2, frameWindow: 3, imageDetail: 'high', modelTier: 'large' });
  expect(recommend(phone({ ramMb: 4000 })).modelTier).toBe('small');
});

test('keep periods follow free space and keep a reserve', () => {
  // 60 GB free, 13 GB reserve -> 47 spare -> video ≥ 72 h capped at 3 days; audio 90 days.
  const roomy = recommend(phone({}));
  expect(roomy.storageReserveGB).toBe(13);
  expect(roomy.videoKeepHours).toBe(72);
  expect(roomy.audioKeepDays).toBe(90);
  // Nearly full: smallest options, reserve at least 2 GB.
  const tight = recommend(phone({ totalStorageBytes: 16 * GB, freeStorageBytes: 3 * GB }));
  expect(tight.storageReserveGB).toBe(2);
  expect(tight.videoKeepHours).toBe(2);
  expect(tight.audioKeepDays).toBe(7);
});

test('slow measured voice picks the system voice', () => {
  expect(recommend(phone({ measuredVoiceFirstSoundMs: 1800 })).voice).toBe('system');
  expect(recommend(phone({ measuredVoiceFirstSoundMs: 600 })).voice).toBe('pocket');
});

test('overrides win, null follows Recommended', () => {
  const r = recommend(phone({ soc: 'Google Tensor G5' }));
  expect(resolveTuning(DEFAULTS, r).fps).toBe(2);
  const t = resolveTuning({ ...DEFAULTS, fps: 0.5, voiceChoice: 'system' }, r);
  expect(t).toMatchObject({ fps: 0.5, voice: 'system', frameWindow: 3 });
});

test('phone features say why something is unavailable', () => {
  const ios = phoneFeatures(phone({ platform: 'ios', usbHost: false }));
  for (const id of ['listen', 'camera', 'pocketVoice', 'directSms'])
    expect(ios.find((f) => f.id === id)).toMatchObject({ available: false });
  expect(ios.find((f) => f.id === 'listen')!.why).toMatch(/iPhone/);
  // Android-only ways in and hardware aren't listed on iPhone at all.
  for (const id of ['usbCamera', 'tile', 'widget', 'assistant', 'splitAudio', 'heat'])
    expect(ios.find((f) => f.id === id)).toBeUndefined();
  expect(ios.find((f) => f.id === 'appLock')!.name).toBe('App lock (Face ID or passcode)');
  const android = phoneFeatures(phone({}));
  expect(android.find((f) => f.id === 'listen')!.available).toBe(true);
  expect(android.find((f) => f.id === 'tile')!.available).toBe(true);
  expect(android.find((f) => f.id === 'appLock')!.name).toBe('App lock (fingerprint, face or PIN)');
  expect(android.find((f) => f.id === 'camera')!.available).toBe(true);
  const play = phoneFeatures(phone({}));
  expect(play.find((f) => f.id === 'directSms')).toMatchObject({ available: false });
  expect(play.find((f) => f.id === 'directSms')!.why).toMatch(/Google Play/);
  expect(play.find((f) => f.id === 'accessibility')!.available).toBe(false);
});

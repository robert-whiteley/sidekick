import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { getSettings, type ImageDetail, type Settings } from './settings';

/** What Sidekick knows about this phone, read instantly (no test needed). */
export type DeviceProfile = {
  platform: 'android' | 'ios' | 'other';
  /** Android API level or iOS major version. */
  osVersion: number;
  manufacturer: string;
  model: string;
  soc: string;
  ramMb: number;
  totalStorageBytes: number;
  freeStorageBytes: number;
  /** Phone can read a USB camera (Android USB host; never on iPhone). */
  usbHost: boolean;
  /** Phone reports its temperature status (Android 10+, iOS). */
  thermalApi: boolean;
  /** Measured silently in the background; null until measured. */
  measuredTokPerSec: number | null;
  measuredVoiceFirstSoundMs: number | null;
};

export type SpeedTier = 'low' | 'mid' | 'high';
export type ModelTier = 'small' | 'standard' | 'large';

/** Recommended values for this phone. Every adjustable setting falls back to one of these. */
export type Recommended = {
  tier: SpeedTier;
  fps: number;
  frameWindow: number;
  imageDetail: ImageDetail;
  videoKeepHours: number;
  audioKeepDays: number;
  voice: 'pocket' | 'system';
  modelTier: ModelTier;
  storageReserveGB: number;
};

const GB = 1024 ** 3;

// Chips fast enough for 2 fps frames and the larger models (GPU/NPU class, 2023+ flagships).
const HIGH_SOC =
  /SM8[5-9]\d0|8 ?Elite|8 Gen [2-9]|Tensor G[3-9]|zuma|laguna|malibu|Dimensity 9[2-9]00|MT699[0-9]|Exynos 2[4-9]00|Apple A1[7-9]|Apple A[2-9]\d|Apple M\d/i;
// Recent upper-mid chips.
const MID_SOC =
  /SM8[34]\d0|SM8475|8 Gen 1|SM7[4-9]\d0|7s? Gen [2-9]|7\+ Gen|Tensor( G[12])?$|Tensor G[12]|gs101|gs201|Dimensity [78][0-9]00|MT6[89][0-9]{2}|Exynos 2[12]00|Exynos 1[4-9]80|Apple A1[56]/i;

/** Speed class: measured speed wins; otherwise the chip, capped by RAM. */
export function speedTier(p: DeviceProfile): SpeedTier {
  if (p.measuredTokPerSec != null) {
    if (p.measuredTokPerSec >= 15) return 'high';
    if (p.measuredTokPerSec >= 8) return 'mid';
    return 'low';
  }
  if (p.ramMb > 0 && p.ramMb < 5500) return 'low';
  if (HIGH_SOC.test(p.soc)) return 'high';
  if (MID_SOC.test(p.soc)) return 'mid';
  return 'low';
}

/** Rounds down to the nearest allowed option (or the smallest one). */
function floorTo(options: number[], v: number): number {
  let best = options[0];
  for (const o of options) if (o <= v) best = o;
  return best;
}

export const FPS_OPTIONS = [0.5, 1, 2];
export const FRAME_WINDOW_OPTIONS = [1, 2, 3];
export const VIDEO_KEEP_OPTIONS = [2, 6, 12, 24, 48, 72, 168, 720]; // hours: 2 h … 1 month
export const AUDIO_KEEP_OPTIONS = [7, 30, 90, 365, 0]; // days; 0 = forever
export const RESERVE_OPTIONS = [1, 2, 4, 8, 16];

/** Video ≈ 0.5 GB per recorded hour; assume the camera records ~8 h per day. */
const VIDEO_GB_PER_KEPT_HOUR = (0.5 * 8) / 24;
/** Speech audio ≈ 20 MB per day (~3 h of speech at Opus 16 kbps). */
const AUDIO_GB_PER_DAY = 0.02;

export function reserveGB(p: DeviceProfile): number {
  const tenth = (p.totalStorageBytes * 0.1) / GB;
  return Math.max(2, Math.ceil(tenth));
}

/** Pure: the Recommended values for a phone (tested). */
export function recommend(p: DeviceProfile): Recommended {
  const tier = speedTier(p);
  const reserve = reserveGB(p);
  const spare = Math.max(0, p.freeStorageBytes / GB - reserve);
  // Video gets up to half the spare space, 1–3 days by default (owner decision).
  const videoKeepHours = floorTo(
    VIDEO_KEEP_OPTIONS.filter((h) => h <= 72),
    (spare * 0.5) / VIDEO_GB_PER_KEPT_HOUR,
  );
  // Audio gets up to a quarter, at most ~3 months by default.
  const audioKeepDays = floorTo(
    AUDIO_KEEP_OPTIONS.filter((d) => d > 0 && d <= 90),
    (spare * 0.25) / AUDIO_GB_PER_DAY,
  );
  const voiceFast =
    p.measuredVoiceFirstSoundMs != null ? p.measuredVoiceFirstSoundMs <= 1000 : p.ramMb >= 5500;
  return {
    tier,
    fps: tier === 'high' ? 2 : tier === 'mid' ? 1 : 0.5,
    frameWindow: tier === 'low' ? 2 : 3,
    imageDetail: tier === 'high' ? 'high' : tier === 'mid' ? 'medium' : 'low',
    videoKeepHours,
    audioKeepDays,
    voice: voiceFast ? 'pocket' : 'system',
    modelTier:
      p.ramMb > 0 && p.ramMb < 5500
        ? 'small'
        : tier === 'high' && p.ramMb >= 11500
          ? 'large'
          : 'standard',
    storageReserveGB: reserve,
  };
}

/** The values features should use: the user's override, else the Recommended one. */
export type Tuning = {
  fps: number;
  frameWindow: number;
  imageDetail: ImageDetail;
  videoKeepHours: number;
  audioKeepDays: number;
  voice: 'pocket' | 'system';
  storageReserveGB: number;
};

export function resolveTuning(s: Settings, r: Recommended): Tuning {
  return {
    fps: s.fps ?? r.fps,
    frameWindow: s.frameWindow ?? r.frameWindow,
    imageDetail: s.imageDetail ?? r.imageDetail,
    videoKeepHours: s.videoKeepHours ?? r.videoKeepHours,
    audioKeepDays: s.audioKeepDays ?? r.audioKeepDays,
    voice: s.voiceChoice === 'auto' ? r.voice : s.voiceChoice,
    storageReserveGB: s.storageReserveGB ?? r.storageReserveGB,
  };
}

export type PhoneFeature = {
  id: string;
  name: string;
  available: boolean;
  /** Why it isn't available (or a caveat), in plain words. */
  why?: string;
};

/** Pure: every feature, with whether this phone can do it and why not (tested). */
export function phoneFeatures(p: DeviceProfile): PhoneFeature[] {
  const android = p.platform === 'android';
  const ios = p.platform === 'ios';
  const notIphone = (what: string) => (ios ? `Not possible on iPhone: ${what}` : 'Android only');
  const tier = speedTier(p);
  const notOnPlay = 'Not possible: Google Play doesn’t allow apps to do this';
  return [
    { id: 'chat', name: 'Ask by typing or voice', available: true },
    { id: 'camera', name: 'Live camera memory', available: true },
    {
      id: 'usbCamera',
      name: 'USB camera (e.g. a worn camera)',
      available: android && p.usbHost,
      why: android ? 'This phone has no USB host support' : notIphone('no USB camera support'),
    },
    {
      id: 'fastChip',
      name: 'Fast answers (AI chip)',
      available: tier !== 'low',
      why: 'Runs on the main processor here, so answers are slower',
    },
    {
      id: 'pocketVoice',
      name: 'Natural voice',
      available: p.ramMb === 0 || p.ramMb >= 3500,
      why: 'Not enough memory on this phone; the system voice is used',
    },
    {
      id: 'heat',
      name: 'Heat protection (slows the camera when hot)',
      available: p.thermalApi,
      why: 'This phone doesn’t report its temperature',
    },
    {
      id: 'readNotifications',
      name: 'Read notifications from other apps',
      available: android,
      why: notIphone('Apple doesn’t let apps read notifications'),
    },
    {
      id: 'replyNotifications',
      name: 'Reply to messages from their notification',
      available: android,
      why: notIphone('Apple doesn’t let apps reply for other apps'),
    },
    {
      id: 'directSms',
      name: 'Send texts directly',
      available: false,
      why: android ? notOnPlay : notIphone('Apple doesn’t let apps send texts'),
    },
    {
      id: 'accessibility',
      name: 'Tap buttons in other apps for you',
      available: false,
      why: android ? notOnPlay : notIphone('Apple doesn’t allow it'),
    },
    {
      id: 'assistant',
      name: 'Open by holding the home button',
      available: android,
      why: notIphone('only Siri can be the assistant'),
    },
    {
      id: 'tile',
      name: 'Quick Settings tile',
      available: android,
      why: notIphone('no Quick Settings tiles'),
    },
    {
      id: 'widget',
      name: 'Home-screen widget',
      available: android,
      why: ios ? 'Not built for iPhone yet' : 'Android only',
    },
    {
      id: 'splitAudio',
      name: 'Headphone mic for commands, camera mic for conversation',
      available: android && p.osVersion >= 29,
      why: android ? 'Needs Android 10 or newer' : notIphone('one microphone at a time'),
    },
    { id: 'offline', name: 'Works fully offline', available: true },
  ];
}

let profile: DeviceProfile | null = null;

function osVersion(): number {
  const v = Platform.Version;
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 0;
}

function diskSpace(): { total: number; free: number } {
  try {
    return { total: Paths.totalDiskSpace, free: Paths.availableDiskSpace };
  } catch {
    return { total: 0, free: 0 };
  }
}

/** Reads the hardware once (instant); free space and measured speeds are re-read each call. */
export function readDeviceProfile(s: Settings = getSettings()): DeviceProfile {
  if (!profile) {
    let info = { manufacturer: '', model: '', soc: '', totalRamMb: 0 };
    try {
      info = SidekickNative.getDeviceInfo();
    } catch {
      // Not available (tests, web): defaults below.
    }
    const platform = Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'other';
    const v = osVersion();
    profile = {
      platform,
      osVersion: v,
      manufacturer: info.manufacturer,
      model: info.model,
      soc: info.soc,
      ramMb: info.totalRamMb,
      totalStorageBytes: 0,
      freeStorageBytes: 0,
      usbHost: platform === 'android',
      thermalApi: platform === 'ios' || (platform === 'android' && v >= 29),
      measuredTokPerSec: null,
      measuredVoiceFirstSoundMs: null,
    };
  }
  const disk = diskSpace();
  return {
    ...profile,
    totalStorageBytes: disk.total,
    freeStorageBytes: disk.free,
    measuredTokPerSec: s.measuredTokPerSec,
    measuredVoiceFirstSoundMs: s.measuredVoiceFirstSoundMs,
  };
}

/** Recommended values for this phone right now. */
export function recommended(s: Settings = getSettings()): Recommended {
  return recommend(readDeviceProfile(s));
}

/** The values to use right now (override, else Recommended). Cheap; call when needed. */
export function currentTuning(): Tuning {
  const s = getSettings();
  return resolveTuning(s, recommended(s));
}

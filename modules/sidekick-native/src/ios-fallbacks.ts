/**
 * The iPhone module (ios/SidekickNativeModule.swift) defines only what an iPhone can do. Every
 * other non-optional call the app makes gets a safe "not on iPhone" answer here, so nothing throws
 * or hangs: background listening, the live camera, USB cameras, notification capture, the Pocket
 * voice, tiles and widgets are Android-only (ADR 0006). The screens explain these in plain words
 * (device-profile.ts, quick-commands.ts). Optional calls (`foo?()`) are left undefined on purpose:
 * the app already checks for them.
 *
 * __tests__/ios-fallbacks-test.ts checks that every non-optional call is covered.
 */
import type {
  AudioDevices,
  CameraStatus,
  CameraStorage,
  DownloadStatus,
  SplitAudioProbe,
  VoiceInfo,
} from './SidekickNative.types';
import { iosHasLocationPermission, iosLastLocation } from './ios-location';

const NEEDS_ANDROID = 'Needs Android.';

const noop = () => {};
const none = () => [];
const no = () => false;

const idleCamera: CameraStatus = {
  running: false,
  source: 'phone',
  activeSource: null,
  paused: false,
  sampleFps: 0,
  videoFps: 0,
  recording: false,
  reason: null,
  videoBlockedForSpace: false,
  framesSeen: 0,
  framesKept: 0,
  pendingEmbeds: 0,
  startedAt: null,
  userPaused: false,
  lockPaused: false,
};

const noStorage: CameraStorage = {
  videoBytes: 0,
  stillsBytes: 0,
  framesBytes: 0,
  pendingBytes: 0,
  freeBytes: 0,
  totalBytes: 0,
  reserveBytes: 0,
  oldestVideoAt: null,
};

const noAudioDevices: AudioDevices = {
  inputs: [],
  outputs: [],
  input: null,
  output: null,
  recommendedInput: null,
  recommendedOutput: null,
};

const systemVoice: VoiceInfo = {
  choice: 'system',
  measuredMs: null,
  override: 'auto',
  active: 'system',
};

const failedDownload: DownloadStatus = { status: 'failed', bytes: 0, total: 0, reason: 0 };
const noSplit: SplitAudioProbe = { possible: false, tested: false, reason: NEEDS_ANDROID };

export const IOS_FALLBACKS: Record<string, unknown> = {
  // Phone integration Apple doesn't offer to apps.
  assistantIsDefault: no,
  openAssistantSettings: no,
  requestAddTile: no,
  requestAddWidget: no,
  mediaButtonsEnable: noop,
  notificationAccessGranted: no,
  openNotificationAccessSettings: noop,
  notificationsSetCapture: noop,
  notificationsDrain: none,

  // Audio routing: iOS picks the microphone and speaker itself.
  audioDevices: () => noAudioDevices,
  audioProbeSplit: async () => noSplit,
  audioSaveEnabled: noop,
  audioSetAsking: noop,
  audioSetOverride: noop,

  // Live camera memory (needs filming in the background).
  cameraStart: no,
  cameraConfigure: noop,
  cameraStop: noop,
  cameraPause: noop,
  cameraStatus: () => idleCamera,
  cameraHold: noop,
  cameraFramesDrain: none,
  cameraLatestFrames: none,
  cameraVideoBetween: async () => [],
  cameraFramesAround: async () => [],
  cameraStorageUsage: async () => noStorage,
  usbCameraList: none,
  usbCameraOpen: no,
  usbCameraUsePhone: noop,
  usbCameraMode: () => null,

  // Background listening and the wake word.
  listenWanted: no,
  listenActive: no,
  listenStart: noop,
  listenStop: noop,
  listenConfigure: noop,
  listenPauseRules: noop,
  listenPauseReason: () => null,
  journalDrain: none,
  setMicPaused: noop,
  speechSetAsrThreads: async () => true,

  // Spoken answers use expo-speech on iPhone (speaker.ts); this is the Android voice queue.
  voiceBegin: () => 0,
  voiceSay: noop,
  voiceEnd: noop,
  voiceStop: noop,
  voiceEngine: () => 'system',
  voiceInfo: () => systemVoice,
  voiceSetChoice: noop,

  // Downloads use expo-file-system on iPhone (downloads.ts); these are Android's DownloadManager.
  downloadStart: () => {
    throw new Error('downloadStart is Android-only');
  },
  downloadStatus: () => failedDownload,
  downloadCancel: noop,
  downloadResume: async () => false,
  // Only the Android speech model is a .tar.bz2; the iPhone doesn't download it.
  extractTarBz2: async () => false,

  // Location via expo-location while the app is open.
  lastLocation: iosLastLocation,
  hasLocationPermission: iosHasLocationPermission,

  // Developer checks (Android test rig).
  debugTranscribe: async () => ({ text: '', wake: false }),
  debugSay: async () => {
    throw new Error(NEEDS_ANDROID);
  },
  debugVoiceprint: async () => null,
  debugVoices: async () => [],
  debugPlay: async () => false,
};

/** Wraps the iPhone native module: native calls first, then the fallbacks above. */
export function withIosFallbacks<T extends object>(native: T): T {
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(native, {
    get(target, prop) {
      const v = Reflect.get(target, prop) as unknown;
      if (v !== undefined) {
        if (typeof v !== 'function') return v;
        // Native functions need their module as `this` (addListener, sendEvent).
        let b = bound.get(prop);
        if (!b) {
          b = (v as (...a: unknown[]) => unknown).bind(target);
          bound.set(prop, b);
        }
        return b;
      }
      return typeof prop === 'string' ? IOS_FALLBACKS[prop] : undefined;
    },
  });
}

import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { notices } from './notices';
import { dataDir, modelsDir } from './paths';
import { currentTuning } from './device-profile';
import { updateSettings } from './settings';
import {
  addSample,
  dailyRate,
  EMPTY_USAGE,
  type Forecast,
  forecast,
  formatBytes,
  type KeepPeriods,
  type MediaFile,
  planCleanup,
  recommendedKeep,
  type Sample,
  type Usage,
} from './storage';
import { pruneMissingMedia } from '@/memory/media-files';

/**
 * Measures the phone's storage, keeps a daily history, applies keep periods, frees space when
 * the reserve is threatened, and posts notices (info when it cleaned up by itself; a decision
 * card only when a limit will be exceeded). See storage.ts for the rules.
 *
 * Media folders are all inside the app's private storage (removed on uninstall); see mediaDirs().
 * The live camera deletes its own video and stills (keep period, free-space reserve) natively;
 * here it is only told the keep periods and reserve, and its usage is shown and forecast.
 */

export type MediaKind = 'video' | 'stills' | 'frames' | 'audio';

/** Where each kind of media lives: the camera recorder's folders, and saved speech audio. */
export function mediaDirs(): Record<MediaKind, string> {
  const files = SidekickNative.getDeviceInfo().filesDir;
  return {
    video: `${files}/camera/video`,
    stills: `${files}/camera/stills`,
    frames: `${files}/camera/frames`,
    audio: `${dataDir()}/audio`,
  };
}

const SAMPLES_KEY = 'storage.samples.v1';
const STILLS_KEY = 'storage.stillsKeepDays.v1';

function dirSize(path: string): number {
  try {
    const d = new Directory(`file://${path}`);
    return d.exists ? (d.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

function databasesDir(): string {
  return `${SidekickNative.getDeviceInfo().filesDir.replace(/\/files\/?$/, '')}/databases`;
}

/** Bytes used per kind, from folder sizes (stills include the camera's keyframes). */
export function measureUsage(): Usage {
  const dirs = mediaDirs();
  return {
    ...EMPTY_USAGE,
    video: dirSize(dirs.video),
    stills: dirSize(dirs.stills) + dirSize(dirs.frames),
    audio: dirSize(dirs.audio),
    photos: dirSize(`${dataDir()}/photos`),
    text: dirSize(databasesDir()),
    models: dirSize(modelsDir()),
  };
}

/** As measureUsage, with the camera recorder's own numbers (includes files still being written). */
export async function measureUsageNow(): Promise<Usage> {
  const u = measureUsage();
  if (Platform.OS !== 'android') return u;
  try {
    const c = await SidekickNative.cameraStorageUsage();
    u.video = c.videoBytes;
    u.stills = c.stillsBytes + c.framesBytes + c.pendingBytes;
  } catch {
    // Camera module not available: folder sizes are fine.
  }
  return u;
}

export function diskSpace(): { free: number; total: number } {
  try {
    return { free: Paths.availableDiskSpace, total: Paths.totalDiskSpace };
  } catch {
    return { free: 0, total: 0 };
  }
}

/** Space always left free: the user's choice, else the Recommended value shown in Settings. */
export function reserveBytes(): number {
  return currentTuning().storageReserveGB * 1e9;
}

export function stillsKeepDays(): number | null {
  const v = SidekickNative.kvGet(STILLS_KEY);
  return v ? Number(v) : null;
}

export function setStillsKeepDays(days: number | null) {
  SidekickNative.kvSet(STILLS_KEY, days == null ? null : String(days));
}

/** Keep periods in force: the user's own, else Recommended for this phone. */
/** Keep periods in force: the user's own, else Recommended for this phone (as Settings shows). */
export function keepPeriods(total = diskSpace().total): KeepPeriods {
  const t = currentTuning();
  return {
    videoKeepHours: t.videoKeepHours,
    audioKeepDays: t.audioKeepDays,
    stillsKeepDays: stillsKeepDays() ?? recommendedKeep(total).stillsKeepDays,
  };
}

function samples(): Sample[] {
  try {
    return JSON.parse(SidekickNative.kvGet(SAMPLES_KEY) ?? '[]') as Sample[];
  } catch {
    return [];
  }
}

function listMedia(): MediaFile[] {
  const out: MediaFile[] = [];
  const walk = (d: Directory, kind: MediaFile['kind']) => {
    for (const e of d.list()) {
      if (e instanceof Directory) walk(e, kind);
      else if (e instanceof File)
        out.push({
          path: decodeURIComponent(e.uri.replace(/^file:\/\//, '')),
          kind,
          at: e.modificationTime ?? Date.now(),
          bytes: e.size ?? 0,
        });
    }
  };
  // Video and stills are cleaned natively by the camera recorder; only audio is cleaned here.
  for (const kind of ['audio'] as const) {
    try {
      const d = new Directory(`file://${mediaDirs()[kind]}`);
      if (d.exists) walk(d, kind);
    } catch {
      // Folder not there yet.
    }
  }
  return out;
}

export type StorageReport = {
  usage: Usage;
  free: number;
  total: number;
  reserve: number;
  keep: KeepPeriods;
  forecast: Forecast;
  cleaned: number;
};

/** Tells the camera recorder the keep periods and reserve in force (it deletes by itself). */
export function applyCameraRetention(total = diskSpace().total) {
  if (Platform.OS !== 'android') return;
  const keep = keepPeriods(total);
  try {
    SidekickNative.cameraConfigure({
      keepVideoHours: keep.videoKeepHours,
      keepStillsDays: keep.stillsKeepDays,
      reserveMb: Math.round(reserveBytes() / 1e6),
    });
  } catch (e) {
    console.log(`[storage] camera retention not set: ${String(e)}`);
  }
}

/** Measure, record, clean up as the rules say, and post notices. */
export function checkStorage(now = Date.now()): StorageReport {
  const { free, total } = diskSpace();
  const reserve = reserveBytes();
  const keep = keepPeriods(total);
  applyCameraRetention(total);
  const plan = planCleanup(listMedia(), Math.max(0, reserve - free), now, keep);
  let cleaned = 0;
  for (const f of [...plan.expired, ...plan.forSpace]) {
    if (SidekickNative.deleteFile(f.path)) cleaned += f.bytes;
  }
  const usage = measureUsage();
  const hist = addSample(samples(), { at: now, usage });
  SidekickNative.kvSet(SAMPLES_KEY, JSON.stringify(hist));
  const after = diskSpace().free || free + cleaned;
  const fc = forecast(after, reserve, dailyRate(hist));
  if (plan.forSpace.length > 0) {
    notices.post({
      key: 'storage-cleanup',
      kind: 'info',
      text: `Freed ${formatBytes(plan.forSpace.reduce((n, f) => n + f.bytes, 0))} by clearing old recordings, to keep space free for your phone.`,
      href: '/storage',
    });
  }
  if (fc.status === 'tight' || fc.status === 'soon') {
    notices.post(
      {
        key: 'storage-full',
        kind: 'decision',
        severity: fc.status === 'tight' ? 2 : 1,
        text:
          fc.status === 'tight'
            ? `Your phone is almost full, even after clearing old video. Free ${formatBytes(fc.shortBy)} or keep less?`
            : `At your current use the phone's space runs out in about ${Math.max(1, Math.floor(fc.daysLeft))} days. Keep less video and audio?`,
        href: '/storage',
        actions: [
          { label: 'Keep less', id: 'keep-less' },
          { label: 'Open storage', id: 'open' },
        ],
      },
      (id) => {
        if (id === 'keep-less') keepLess(total);
      },
    );
  }
  return { usage, free: after, total, reserve, keep, forecast: fc, cleaned };
}

/** Halves the video and audio keep periods (down to 2 hours / 7 days) and cleans up. */
function keepLess(total: number) {
  const k = keepPeriods(total);
  updateSettings({
    videoKeepHours: Math.max(2, Math.floor(k.videoKeepHours / 2)),
    audioKeepDays: Math.max(7, Math.floor((k.audioKeepDays || 60) / 2)),
  });
  checkStorage();
}

/** The camera recorder's own storage events, in plain words. */
function onCameraStorage(e: { reason: 'reserve' | 'ok'; shortBytes: number; video: boolean }) {
  if (e.reason === 'ok') return;
  notices.post({
    key: 'camera-storage',
    kind: 'info',
    text: e.video
      ? 'Phone storage is low: video recording paused; the camera still remembers what it sees.'
      : `Phone storage is low: cleared the oldest camera stills (${formatBytes(e.shortBytes)} more needed).`,
    href: '/storage',
  });
}

/** Checks now and every hour; returns a stop function. Call once the app is set up. */
export function startStorageMonitor(): () => void {
  const run = () => {
    try {
      checkStorage();
    } catch (e) {
      console.log(`[storage] check failed: ${String(e)}`);
    }
    // Memories whose photo or audio was cleaned up stop pointing at the missing file.
    pruneMissingMedia().catch((e) => console.log(`[storage] prune failed: ${String(e)}`));
  };
  run();
  const t = setInterval(run, 60 * 60_000);
  const sub =
    Platform.OS === 'android'
      ? SidekickNative.addListener('onCamera', (e) => {
          if (e.kind === 'storage') onCameraStorage(e);
        })
      : null;
  return () => {
    clearInterval(t);
    sub?.remove();
  };
}

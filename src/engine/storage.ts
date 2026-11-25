/**
 * Storage: what uses space, how fast this user fills it, when it will run out, and what to
 * delete first (docs/PLAN-v2.md "Storage"). Pure logic, tested; storage-monitor.ts measures the
 * phone and acts on it.
 *
 * Rules: always leave a reserve free for the phone (Recommended max(2 GB, 10%)); when space is
 * tight the oldest video goes first, then camera stills older than their keep period; text,
 * vectors and photos the user asked about are never deleted without asking.
 */

export type StorageKind = 'video' | 'stills' | 'photos' | 'audio' | 'text' | 'models';

export const KIND_LABELS: Record<StorageKind, string> = {
  video: 'Video',
  stills: 'Camera stills',
  photos: 'Photos you asked about',
  audio: 'Conversation audio',
  text: 'Text and memory index',
  models: 'AI models',
};

export type Usage = Record<StorageKind, number>;

export const EMPTY_USAGE: Usage = { video: 0, stills: 0, photos: 0, audio: 0, text: 0, models: 0 };

const GB = 1e9;
const DAY = 86_400_000;

/** Space always left free for the phone itself. */
export function recommendedReserve(totalBytes: number): number {
  return Math.max(2 * GB, 0.1 * totalBytes);
}

export type KeepPeriods = { videoKeepHours: number; audioKeepDays: number; stillsKeepDays: number };

/**
 * Recommended keep periods by phone storage size. Video is ~0.5 GB per hour of live camera,
 * speech audio ~20 MB a day, stills small; text and vectors are kept for good.
 */
export function recommendedKeep(totalBytes: number): KeepPeriods {
  if (totalBytes >= 400 * GB)
    return { videoKeepHours: 72, audioKeepDays: 365, stillsKeepDays: 365 };
  if (totalBytes >= 200 * GB)
    return { videoKeepHours: 48, audioKeepDays: 180, stillsKeepDays: 180 };
  if (totalBytes >= 100 * GB) return { videoKeepHours: 24, audioKeepDays: 90, stillsKeepDays: 90 };
  return { videoKeepHours: 8, audioKeepDays: 30, stillsKeepDays: 30 };
}

/** One measurement a day (the day's last), so the use rate comes from real use. */
export type Sample = { at: number; usage: Usage };

function dayOf(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Keeps one sample per day (the newest) for the last [keepDays] days. */
export function addSample(samples: Sample[], s: Sample, keepDays = 60): Sample[] {
  const out = samples.filter((x) => dayOf(x.at) !== dayOf(s.at) && s.at - x.at < keepDays * DAY);
  return [...out, s].sort((a, b) => a.at - b.at);
}

/**
 * Bytes added per day by this user's use, or null before a day of history. Only growth counts:
 * a drop (cleanup, deleting memories) says nothing about how fast new things arrive.
 */
export function dailyRate(samples: Sample[]): number | null {
  if (samples.length < 2) return null;
  const span = samples[samples.length - 1].at - samples[0].at;
  if (span < 0.8 * DAY) return null;
  let added = 0;
  for (let i = 1; i < samples.length; i++) {
    const kinds = Object.keys(EMPTY_USAGE) as StorageKind[];
    for (const k of kinds) {
      if (k === 'models') continue;
      added += Math.max(0, samples[i].usage[k] - samples[i - 1].usage[k]);
    }
  }
  return (added / span) * DAY;
}

/** Forecasts plan with this much headroom on the measured rate. */
export const SAFETY_MARGIN = 1.5;
/** Warn when the space left lasts less than this. */
export const WARN_DAYS = 7;

export type Forecast =
  | { status: 'unknown'; text: string }
  | { status: 'ok' | 'soon'; daysLeft: number; text: string }
  | { status: 'tight'; shortBy: number; text: string };

export function forecast(freeBytes: number, reserveBytes: number, rate: number | null): Forecast {
  const usable = freeBytes - reserveBytes;
  if (usable <= 0)
    return {
      status: 'tight',
      shortBy: -usable,
      text: 'Less space free than the phone needs; older video is being cleared.',
    };
  if (rate == null) return { status: 'unknown', text: 'Forecast available after 1 day of use' };
  if (rate <= 0)
    return { status: 'ok', daysLeft: Infinity, text: 'Plenty of space at your current use' };
  const daysLeft = usable / (rate * SAFETY_MARGIN);
  const when =
    daysLeft > 730
      ? 'more than 2 years'
      : daysLeft > 60
        ? `about ${Math.round(daysLeft / 30)} months`
        : `about ${Math.max(1, Math.floor(daysLeft))} day${Math.floor(daysLeft) === 1 ? '' : 's'}`;
  return {
    status: daysLeft < WARN_DAYS ? 'soon' : 'ok',
    daysLeft,
    text: `At your current use (${formatBytes(rate)} a day), space lasts ${when}.`,
  };
}

export type MediaFile = {
  path: string;
  kind: 'video' | 'stills' | 'audio';
  at: number;
  bytes: number;
};

/**
 * What to delete. Always: video and audio past their keep period (0 = keep audio forever).
 * Then, only while [needBytes] more must be freed: the oldest video, then stills older than
 * their keep period, oldest first. Never text, vectors or asked-about photos.
 */
export function planCleanup(
  files: MediaFile[],
  needBytes: number,
  now: number,
  keep: KeepPeriods,
): { expired: MediaFile[]; forSpace: MediaFile[] } {
  const isExpired = (f: MediaFile) =>
    (f.kind === 'video' && now - f.at > keep.videoKeepHours * 3_600_000) ||
    (f.kind === 'audio' && keep.audioKeepDays > 0 && now - f.at > keep.audioKeepDays * DAY);
  const expired = files.filter(isExpired);
  let need = needBytes - expired.reduce((n, f) => n + f.bytes, 0);
  const forSpace: MediaFile[] = [];
  const rest = files.filter((f) => !isExpired(f)).sort((a, b) => a.at - b.at);
  const order = [
    ...rest.filter((f) => f.kind === 'video'),
    ...rest.filter((f) => f.kind === 'stills' && now - f.at > keep.stillsKeepDays * DAY),
  ];
  for (const f of order) {
    if (need <= 0) break;
    forSpace.push(f);
    need -= f.bytes;
  }
  return { expired, forSpace };
}

export function formatBytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${Math.round(n)} B`;
}

/** Space a set of downloads needs, incl. unpacking archives (about twice their size briefly). */
export function spaceNeeded(files: { bytes: number; unpackedCheck?: string }[]): number {
  return files.reduce((n, f) => n + (f.unpackedCheck ? f.bytes * 2.5 : f.bytes), 0);
}

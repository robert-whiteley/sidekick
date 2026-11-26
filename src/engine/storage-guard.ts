/**
 * What may still be written while the phone is short of space. Two levels:
 * - low (free space under the reserve, Settings → Storage): automatic recordings pause (video,
 *   camera stills, conversation audio; native, same rule), and a download must not take the phone
 *   under the reserve. Photos the user takes and what is heard (as words) are still saved.
 * - full (under FLOOR_BYTES, at most the reserve): nothing big is written: no photos, keyframes,
 *   audio, downloads or new memories. Heard lines wait in the listener's journal on the phone (a
 *   few KB) and are saved once space is back. Stopping well before the disk is full means the
 *   database never runs out of room mid-write, so it can't be left half-written.
 * The native side applies the same levels (StorageGuard.kt). Pure parts tested.
 */
import { Paths } from 'expo-file-system';

import { currentTuning } from './device-profile';
import { notices } from './notices';
import { formatBytes } from './storage';

export type SpaceLevel = 'ok' | 'low' | 'full';
export type BigWrite = 'photo' | 'audio' | 'camera' | 'memory' | 'download';

/** Below this much free space (or 1% of the phone, if more; never above the reserve) nothing big is written. */
export const FLOOR_BYTES = 500e6;

export function floorBytes(total: number, reserve: number): number {
  return Math.min(reserve, Math.max(FLOOR_BYTES, total * 0.01));
}

export function spaceLevel(free: number, total: number, reserve: number): SpaceLevel {
  if (free < floorBytes(total, reserve)) return 'full';
  if (free < reserve) return 'low';
  return 'ok';
}

/** Whether a write of [kind] may go ahead (downloads: see downloadFits). */
export function mayWrite(kind: BigWrite, level: SpaceLevel): boolean {
  if (level === 'ok') return true;
  if (level === 'full') return false;
  // Low: what the user asks for (photos) and what is heard (as text) go on; recordings pause.
  return kind === 'photo' || kind === 'memory' || kind === 'download';
}

/** Whether a download of [bytes] keeps the phone at or above its reserve; else how much is short. */
export function downloadFits(
  bytes: number,
  free: number,
  reserve: number,
): { ok: boolean; shortBy: number } {
  const shortBy = Math.max(0, bytes + reserve - free);
  return { ok: shortBy === 0, shortBy };
}

/** The message shown when a write is refused. */
export function spaceMessage(kind: BigWrite, free: number, shortBy = 0): string {
  const left = formatBytes(Math.max(0, free));
  switch (kind) {
    case 'photo':
      return `Phone storage is full (${left} free). Free up space and try again.`;
    case 'download':
      return `Not enough space for this download: free up ${formatBytes(shortBy)} on your phone and try again.`;
    case 'memory':
      return `Phone storage is full (${left} free): new memories wait on the phone and are saved once space is free.`;
    default:
      return `Phone storage is full (${left} free): Sidekick has paused saving recordings.`;
  }
}

export class StorageFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageFullError';
  }
}

/** What the storage check says while space is short (null when it isn't). */
export function spaceStateMessage(level: SpaceLevel, free: number): string | null {
  const left = formatBytes(Math.max(0, free));
  if (level === 'low')
    return `Phone storage is low (${left} free): video, camera stills and conversation audio are paused. What is said and your photos are still saved.`;
  if (level === 'full')
    return `Phone storage is full (${left} free): Sidekick has stopped saving photos, recordings, downloads and new memories until space is free. Heard lines wait on the phone.`;
  return null;
}

/** Free and total bytes on the app's disk (0, 0 if unknown: never blocks then). */
function disk(): { free: number; total: number } {
  try {
    return { free: Paths.availableDiskSpace, total: Paths.totalDiskSpace };
  } catch {
    return { free: 0, total: 0 };
  }
}

/** The reserve in force: the user's choice, else Recommended (as storage-monitor.ts). */
const reserve = () => currentTuning().storageReserveGB * 1e9;

let cached: { at: number; level: SpaceLevel; free: number } | null = null;
const CACHE_MS = 5_000;

/** The level now (re-read at most every 5 s, so checks before each write cost nothing). */
export function currentSpace(now = Date.now()): { level: SpaceLevel; free: number } {
  if (cached && now - cached.at < CACHE_MS) return cached;
  const d = disk();
  const level = d.total > 0 ? spaceLevel(d.free, d.total, reserve()) : 'ok';
  cached = { at: now, level, free: d.free };
  return cached;
}

/** Tests, and after the storage screen frees space. */
export function forgetSpaceLevel() {
  cached = null;
  posted.clear();
}

const posted = new Map<string, number>();
/** A refused write's notice, at most every 10 minutes per kind (ingest refuses on every line). */
function noticeOnce(kind: BigWrite, text: string, now: number) {
  if (now - (posted.get(kind) ?? -Infinity) < 10 * 60_000) return;
  posted.set(kind, now);
  notices.post({ key: `storage-${kind}`, kind: 'info', text, href: '/storage' });
}

/** Throws StorageFullError (with the message, also posted as a notice) if [kind] can't be written. */
export function guardWrite(kind: Exclude<BigWrite, 'download'>, now = Date.now()) {
  const s = currentSpace(now);
  if (mayWrite(kind, s.level)) return;
  const text = spaceMessage(kind, s.free);
  noticeOnce(kind, text, now);
  throw new StorageFullError(text);
}

/** False (with a notice) when new memories must wait: the database is not written then. */
export function mayGrowMemory(): boolean {
  try {
    guardWrite('memory');
    return true;
  } catch {
    return false;
  }
}

/** Throws StorageFullError if a download of [bytes] would take the phone under its reserve. */
export function guardDownload(bytes: number) {
  const d = disk();
  if (d.total <= 0) return;
  const fit = downloadFits(bytes, d.free, reserve());
  if (!fit.ok) throw new StorageFullError(spaceMessage('download', d.free, fit.shortBy));
}

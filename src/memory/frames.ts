import { Platform } from 'react-native';

import SidekickNative, { type FrameJournalEntry } from '../../modules/sidekick-native';
import { EMBED_DIMS, getDb, vecParam } from './db';
import { keptFile } from './media-files';
import { OCR_NO_TEXT, OCR_PENDING, readTextOf } from './photo-ocr';
import type { Segment } from '@/features/media/media-logic';

/**
 * Live camera frames in memory. The native pipeline embeds each kept frame (EmbeddingGemma 2,
 * the same vector space as text questions) and writes a journal line; here each line becomes a
 * moment (kind 'frame') with its vector in photos_vec, so "red car" finds a red-car frame
 * directly. Frames with text get a full-resolution still and are OCR'd like photos.
 */

/** One journal line from the native camera pipeline (vector null: embedded later in JS). */
export type FrameLine = {
  kind: 'frame';
  at: number;
  path: string;
  vector: number[] | null;
  ocrNeeded: boolean;
  /** Full-resolution still (text or a plate was seen): the photo kept for that moment. */
  stillPath?: string;
};

/** The live camera exists on Android only. */
const android = Platform.OS === 'android';

/** Parses one journal line; null when it is not a usable frame (wrong kind, size or JSON). */
export function parseFrameLine(line: string): FrameLine | null {
  try {
    const x = JSON.parse(line) as Partial<FrameJournalEntry>;
    if (x.kind !== 'frame' || typeof x.at !== 'number' || typeof x.path !== 'string') return null;
    const vector = Array.isArray(x.vector) && x.vector.length === EMBED_DIMS ? x.vector : null;
    // A vector of the wrong size is unusable; null means "not embedded yet".
    if (x.vector != null && !vector) return null;
    return {
      kind: 'frame',
      at: x.at,
      path: x.path,
      vector,
      ocrNeeded: !!x.ocrNeeded,
      stillPath: typeof x.stillPath === 'string' ? x.stillPath : undefined,
    };
  } catch {
    return null;
  }
}

let draining: Promise<number> | null = null;

/** Told about each batch of new embedded frames (camera watches, see engine/focus-watch.ts). */
const frameListeners = new Set<
  (frames: { at: number; path: string; vector: number[] }[]) => void
>();
export function onNewFrames(
  l: (frames: { at: number; path: string; vector: number[] }[]) => void,
): () => void {
  frameListeners.add(l);
  return () => frameListeners.delete(l);
}

/** Moves new frames from the native journal into memory; returns how many were added. */
export function ingestFrames(): Promise<number> {
  if (!android) return Promise.resolve(0);
  draining ??= ingestNow().finally(() => (draining = null));
  return draining;
}

async function ingestNow(): Promise<number> {
  const frames = SidekickNative.cameraFramesDrain(null)
    .map(parseFrameLine)
    .filter((f) => !!f);
  if (!frames.length) return 0;
  const db = await getDb();
  const toRead: number[] = [];
  await db.transaction(async (tx) => {
    for (const f of frames) {
      // The full-resolution still (text or a plate was seen) is the photo kept for that moment.
      const r = await tx.execute(
        'INSERT INTO moments (kind, at, text, photo_path, image_embedded, photo_ocr) VALUES (?, ?, ?, ?, ?, ?)',
        [
          'frame',
          f.at,
          '',
          f.stillPath ?? f.path,
          f.vector ? 1 : 0,
          f.ocrNeeded ? OCR_PENDING : OCR_NO_TEXT,
        ],
      );
      const id = r.insertId!;
      // Not embedded natively (no model then): the background embedder picks it up.
      if (f.vector)
        await tx.execute('INSERT INTO photos_vec (id, embedding) VALUES (?, ?)', [
          id,
          vecParam(f.vector),
        ]);
      if (f.ocrNeeded) toRead.push(id);
    }
  });
  const embedded = frames.flatMap((f) =>
    f.vector ? [{ at: f.at, path: f.path, vector: f.vector }] : [],
  );
  if (embedded.length) frameListeners.forEach((l) => l(embedded));
  // OCR after the batch is saved (each ~1 s); not awaited so ingest never blocks a question.
  for (const id of toRead) void readTextOf(id).catch(() => {});
  return frames.length;
}

export type FrameHit = { id: number; at: number; sim: number; path: string | null; text: string };

/**
 * The stored frames and photos nearest a question vector, with similarities (1 − cosine
 * distance), optionally inside a time window. `k` is large so the confidence gate can measure
 * the crowd.
 */
export async function nearestSeen(
  qv: number[],
  k = 200,
  win?: { from: number; to: number } | null,
): Promise<FrameHit[]> {
  const db = await getDb();
  const r = await db.execute(
    'SELECT id, distance FROM photos_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance',
    [vecParam(qv), k],
  );
  const dist = new Map(r.rows.map((x) => [x.id as number, x.distance as number]));
  if (!dist.size) return [];
  const ids = [...dist.keys()];
  const rows = await db.execute(
    `SELECT id, at, photo_path, text FROM moments WHERE id IN (${ids.map(() => '?').join(',')})
     AND kind IN ('frame', 'photo')${win ? ' AND at >= ? AND at < ?' : ''}`,
    win ? [...ids, win.from, win.to] : ids,
  );
  return rows.rows
    .map((x) => ({
      id: x.id as number,
      at: x.at as number,
      sim: 1 - (dist.get(x.id as number) ?? 1),
      path: keptFile(x.photo_path as string | null),
      text: (x.text as string) ?? '',
    }))
    .sort((a, b) => b.sim - a.sim);
}

/** Frames and photos inside a time window, oldest first (for "what did I see this morning"). */
export async function seenBetween(from: number, to: number, limit = 2000): Promise<FrameHit[]> {
  const db = await getDb();
  const r = await db.execute(
    "SELECT id, at, photo_path, text FROM moments WHERE kind IN ('frame', 'photo') AND at >= ? AND at < ? ORDER BY at LIMIT ?",
    [from, to, limit],
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    at: x.at as number,
    sim: 0,
    path: keptFile(x.photo_path as string | null),
    text: (x.text as string) ?? '',
  }));
}

/** Stored frames/photos nearest a time, up to `n` either side (photo swipe), oldest first. */
export async function framesNear(at: number, n = 10): Promise<{ at: number; path: string }[]> {
  const db = await getDb();
  const q = (cmp: string, order: string) =>
    db.execute(
      `SELECT at, photo_path FROM moments WHERE kind IN ('frame', 'photo') AND photo_path IS NOT NULL AND at ${cmp} ? ORDER BY at ${order} LIMIT ?`,
      [at, n],
    );
  const [before, after] = await Promise.all([q('<', 'DESC'), q('>=', 'ASC')]);
  return [...before.rows.reverse(), ...after.rows].flatMap((x) => {
    const path = keptFile(x.photo_path as string);
    return path ? [{ at: x.at as number, path }] : [];
  });
}

/** The text read from a frame (OCR "Read:" line), reading it now if it wasn't yet. */
export async function textOfFrame(id: number): Promise<string> {
  await readTextOf(id).catch(() => {});
  const db = await getDb();
  const r = await db.execute('SELECT text FROM moments WHERE id = ?', [id]);
  return (r.rows[0]?.text as string | undefined) ?? '';
}

/** Video files stored between two times, oldest first (empty when none are kept). */
export async function videoSegments(fromMs: number, toMs: number): Promise<Segment[]> {
  if (!android) return [];
  try {
    const slices = await SidekickNative.cameraVideoBetween(fromMs, toMs);
    return slices.map((v) => ({ path: v.path, startMs: v.startMs, endMs: v.endMs }));
  } catch (e) {
    console.log(`[video] lookup failed: ${String(e)}`);
    return [];
  }
}

/** `n` keyframe files around a moment, `spacingMs` apart, oldest first. */
export async function framePathsAround(
  at: number,
  n: number,
  spacingMs: number,
): Promise<string[]> {
  if (!android) return [];
  try {
    return (await SidekickNative.cameraFramesAround(at, n, spacingMs)).map((f) => f.path);
  } catch {
    return [];
  }
}

/** The camera's last `n` frames, oldest first (empty when the camera is off). */
export function latestFramePaths(n: number): string[] {
  if (!android) return [];
  try {
    return SidekickNative.cameraLatestFrames(n).map((f) => f.path);
  } catch {
    return [];
  }
}

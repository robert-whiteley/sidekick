import SidekickNative from '../../modules/sidekick-native';
import { getDb } from './db';

/**
 * Photos, frames and audio are deleted after their keep period (the camera recorder and storage
 * cleanup do it), but the memories that pointed to them stay: their text and vectors are kept
 * for years. These helpers make sure nothing tries to show or read a file that is gone.
 */

/** The path if its file is still on the phone, else null. */
export function keptFile(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    return SidekickNative.fileExists(path.replace(/^file:\/\//, '')) ? path : null;
  } catch {
    return null;
  }
}

const PRUNE_BATCH = 500;

/**
 * Clears photo_path / audio_path on memories whose file is gone, oldest first (files are deleted
 * oldest first, so it stops at the first batch where every file is still there). Text and vectors
 * stay. Returns how many references were cleared.
 */
export async function pruneMissingMedia(
  exists: (p: string) => boolean = (p) => keptFile(p) !== null,
): Promise<number> {
  const db = await getDb();
  let cleared = 0;
  let after = -1;
  for (;;) {
    const r = await db.execute(
      'SELECT id, photo_path, audio_path FROM moments WHERE (photo_path IS NOT NULL OR audio_path IS NOT NULL) AND id > ? ORDER BY id LIMIT ?',
      [after, PRUNE_BATCH],
    );
    if (!r.rows.length) break;
    let gone = 0;
    for (const x of r.rows) {
      const id = x.id as number;
      after = id;
      const photo = x.photo_path as string | null;
      const audio = x.audio_path as string | null;
      const noPhoto = !!photo && !exists(photo);
      const noAudio = !!audio && !exists(audio);
      if (!noPhoto && !noAudio) continue;
      gone++;
      await db.execute(
        `UPDATE moments SET ${[noPhoto && 'photo_path = NULL', noAudio && 'audio_path = NULL'].filter(Boolean).join(', ')} WHERE id = ?`,
        [id],
      );
      cleared += (noPhoto ? 1 : 0) + (noAudio ? 1 : 0);
    }
    if (gone === 0 || r.rows.length < PRUNE_BATCH) break;
  }
  return cleared;
}

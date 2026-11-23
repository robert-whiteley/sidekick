import SidekickNative from '../../modules/sidekick-native';
import { ocrReady, readPhotoText } from '@/engine/photo-ocr';
import { getDb } from './db';
import { appendRead } from './photo-text';

/** moments.photo_ocr: not read yet / read, no text (or unreadable) / read, text found. */
export const OCR_PENDING = 0;
export const OCR_NO_TEXT = 1;
export const OCR_FOUND = 2;

let chain: Promise<unknown> = Promise.resolve();

/** One at a time: a capture and the catch-up never read the same photo twice at once. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = chain.then(job, job);
  chain = next.catch(() => {});
  return next;
}

/**
 * Reads the text in one saved photo into its moment (`Read: "..."`), so word search finds it
 * at once; the moment is queued for re-embedding so meaning search finds it too.
 */
export function readTextOf(momentId: number): Promise<void> {
  return serial(async () => {
    if (!ocrReady()) return;
    const db = await getDb();
    const r = await db.execute('SELECT text, photo_path, photo_ocr FROM moments WHERE id = ?', [
      momentId,
    ]);
    const row = r.rows[0];
    const path = row?.photo_path as string | null | undefined;
    if (!row || !path || row.photo_ocr !== OCR_PENDING) return;
    let read: string | null = null;
    try {
      if (SidekickNative.fileExists(path)) read = await readPhotoText(path);
    } catch (e) {
      // Unreadable photo: marked done rather than retried forever.
      console.log(`[ocr] moment ${momentId} failed: ${String(e)}`);
    }
    if (read) {
      await db.execute('UPDATE moments SET text = ?, embedded = 0, photo_ocr = ? WHERE id = ?', [
        appendRead(row.text as string, read),
        OCR_FOUND,
        momentId,
      ]);
    } else {
      await db.execute('UPDATE moments SET photo_ocr = ? WHERE id = ?', [OCR_NO_TEXT, momentId]);
    }
  });
}

/** Catch-up for photos saved before OCR was downloaded (or by photo questions). Newest first. */
export async function readPendingPhotoText(limit = 8): Promise<number> {
  if (!ocrReady()) return 0;
  const db = await getDb();
  const r = await db.execute(
    'SELECT id FROM moments WHERE photo_path IS NOT NULL AND photo_ocr = ? ORDER BY id DESC LIMIT ?',
    [OCR_PENDING, limit],
  );
  for (const row of r.rows) await readTextOf(row.id as number);
  return r.rows.length;
}

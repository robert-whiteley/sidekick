import { getDb } from './db';

/**
 * Heard lines not yet checked for another language ("Understand other languages around me"):
 * the newest first so what is said now is translated first; older than 2 days is left alone.
 */
export async function linesToCheck(
  limit: number,
  now = Date.now(),
): Promise<{ id: number; at: number; text: string }[]> {
  const db = await getDb();
  const r = await db.execute(
    "SELECT id, at, text FROM moments WHERE lang IS NULL AND kind = 'speech' AND length(text) > 0 AND at >= ? ORDER BY at DESC LIMIT ?",
    [now - 2 * 86_400_000, limit],
  );
  return r.rows.map((x) => ({ id: x.id as number, at: x.at as number, text: x.text as string }));
}

/** English (or unsure): checked, nothing to translate. */
export async function markEnglish(ids: number[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.execute(
    `UPDATE moments SET lang = 'en' WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
}

/** Stores the line with its English translation and re-embeds it (searchable in English too). */
export async function saveTranslation(id: number, lang: string, text: string) {
  const db = await getDb();
  await db.execute('UPDATE moments SET text = ?, lang = ?, embedded = 0 WHERE id = ?', [
    text,
    lang,
    id,
  ]);
}

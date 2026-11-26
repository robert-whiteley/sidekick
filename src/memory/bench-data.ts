/**
 * Dev-only test data for the recall bench (Settings › Advanced › Speed test; never in product
 * screens): adds made-up memories tagged source_key 'bench:<key>', embeds them, counts what is in
 * the store and removes exactly the tagged rows again. The owner's own memories are only counted,
 * never read.
 */
import SidekickNative from '../../modules/sidekick-native';
import { isDownloaded, modelPath } from '@/engine/downloads';
import { EMBEDDER_FILE } from '@/engine/models';
import { EMBED_DIMS, getDb, vecParam } from './db';
import { embedDocument } from './search-logic';

export const BENCH_PREFIX = 'bench:';

export type BenchRow = { key: string; kind: string; at: number; text: string; filler?: boolean };

export type StoreCounts = {
  /** Rows that aren't bench data, by kind (counts only). */
  own: Record<string, number>;
  ownTotal: number;
  bench: number;
  facts: number;
  speakers: number;
  /** Bytes in use: (pages - free pages) × page size. */
  usedBytes: number;
  fileBytes: number;
};

const n = (r: { rows: Record<string, unknown>[] }) => Number(r.rows[0]?.n ?? 0);

export async function storeCounts(): Promise<StoreCounts> {
  const d = await getDb();
  const kinds = await d.execute(
    "SELECT kind, COUNT(*) AS n FROM moments WHERE source_key IS NULL OR substr(source_key, 1, 6) != 'bench:' GROUP BY kind",
  );
  const own: Record<string, number> = {};
  for (const r of kinds.rows) own[r.kind as string] = Number(r.n);
  const pages = Number((await d.execute('PRAGMA page_count')).rows[0]?.page_count ?? 0);
  const free = Number((await d.execute('PRAGMA freelist_count')).rows[0]?.freelist_count ?? 0);
  const size = Number((await d.execute('PRAGMA page_size')).rows[0]?.page_size ?? 0);
  return {
    own,
    ownTotal: Object.values(own).reduce((a, b) => a + b, 0),
    bench: n(
      await d.execute(
        "SELECT COUNT(*) AS n FROM moments WHERE substr(source_key, 1, 6) = 'bench:'",
      ),
    ),
    facts: n(await d.execute('SELECT COUNT(*) AS n FROM facts')),
    speakers: n(await d.execute('SELECT COUNT(*) AS n FROM speakers')),
    usedBytes: (pages - free) * size,
    fileBytes: pages * size,
  };
}

/**
 * Adds [rows] with real text vectors. Filler rows past the first [uniqueFiller] reuse an earlier
 * filler's vector (the search cost is the same; a Pixel 5 needs ~0.25 s per real vector).
 * Returns how many were embedded for real.
 */
export async function addBenchRows(
  rows: BenchRow[],
  opts: { uniqueFiller?: number; onProgress?: (done: number) => void } = {},
): Promise<number> {
  if (!isDownloaded(EMBEDDER_FILE)) throw new Error('memory search model not downloaded');
  const d = await getDb();
  const unique = opts.uniqueFiller ?? 1000;
  // Real vectors for every signal row and the first [unique] filler rows.
  let seen = 0;
  const real = rows.map((r) => !r.filler || seen++ < unique);
  const fillerVecs: number[][] = [];
  let reused = 0;
  for (let i = 0; i < rows.length; i += 32) {
    const batch = rows.slice(i, i + 32);
    const toEmbed = batch.filter((_, j) => real[i + j]);
    const vecs = toEmbed.length
      ? await SidekickNative.embed(
          modelPath(EMBEDDER_FILE),
          toEmbed.map((r) => embedDocument(r.text)),
          EMBED_DIMS,
        )
      : [];
    await d.transaction(async (tx) => {
      let k = 0;
      for (let j = 0; j < batch.length; j++) {
        const r = batch[j];
        // Marked as already read, so no background pass (follow-ups, facts, OCR, photo vectors)
        // makes suggestions from test data that would outlive it.
        const ins = await tx.execute(
          'INSERT INTO moments (kind, at, text, source_key, source_ver, embedded, from_at, followups_scanned, facts_scanned, photo_ocr, image_embedded) VALUES (?, ?, ?, ?, ?, 1, ?, 1, 1, 1, 1)',
          [
            r.kind,
            r.at,
            r.text,
            `${BENCH_PREFIX}${r.key}`,
            'bench',
            r.kind === 'conversation_note' ? r.at - 20 * 60_000 : null,
          ],
        );
        let v: number[];
        if (real[i + j]) {
          v = vecs[k++];
          if (r.filler) fillerVecs.push(v);
        } else {
          v = fillerVecs[reused++ % Math.max(1, fillerVecs.length)];
        }
        await tx.execute('INSERT INTO moments_vec (id, embedding) VALUES (?, ?)', [
          ins.insertId!,
          vecParam(v),
        ]);
      }
    });
    opts.onProgress?.(Math.min(rows.length, i + batch.length));
  }
  return real.filter(Boolean).length;
}

/** Keys (without the prefix) of bench rows among [ids]; other ids map to null. */
export async function benchKeys(ids: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>(ids.map((id) => [id, null]));
  if (!ids.length) return out;
  const d = await getDb();
  const r = await d.execute(
    `SELECT id, source_key FROM moments WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  for (const x of r.rows) {
    const k = x.source_key as string | null;
    if (k?.startsWith(BENCH_PREFIX)) out.set(x.id as number, k.slice(BENCH_PREFIX.length));
  }
  return out;
}

/** Removes every bench row (vectors and word index included). Returns how many. */
export async function clearBenchRows(): Promise<number> {
  const d = await getDb();
  const where = "substr(source_key, 1, 6) = 'bench:'";
  const count = n(await d.execute(`SELECT COUNT(*) AS n FROM moments WHERE ${where}`));
  for (const table of ['moments_vec', 'photos_vec'])
    await d.execute(`DELETE FROM ${table} WHERE id IN (SELECT id FROM moments WHERE ${where})`);
  await d.execute(`DELETE FROM moments WHERE ${where}`);
  return count;
}

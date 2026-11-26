/**
 * Gives back the space of deleted memories, and makes deletes real.
 *
 * sqlite-vec's vec0 tables keep vectors in fixed chunks of 1024 slots: a delete only clears a
 * slot's bit, the vector bytes stay in the file, and the slot is never reused (measured with
 * sqlite-vec 0.1.6: deleting 5,000 vectors freed nothing, and adding 5,000 more grew the file
 * again). Re-embedding (delete + insert) leaks the same way. The word index (FTS5) also keeps
 * deleted words until its segments are merged. So after deletes: rebuild a vector table once it
 * has a chunk's worth of dead slots, merge the word index, and VACUUM when enough pages are free.
 * Freed pages are zeroed (secure_delete, set in db.ts), so deleted text doesn't linger either.
 */
import type { DB } from '@op-engineering/op-sqlite';
import { getDb, vecTableSql } from './db';

export const VEC_TABLES = ['moments_vec', 'photos_vec'] as const;
/** vec0's default chunk size. */
export const CHUNK_SLOTS = 1024;

/** Rebuild when the dead slots fill a whole chunk (or any are left, when forced). */
export function needsRebuild(capacity: number, live: number, force = false): boolean {
  const dead = capacity - live;
  return force ? dead > 0 : dead >= CHUNK_SLOTS;
}

/** VACUUM rewrites the whole file: only when at least 1 MB, and a tenth of it, is free. */
export function vacuumWorthIt(freeBytes: number, fileBytes: number, force = false): boolean {
  if (force) return freeBytes > 0;
  return freeBytes >= 1_048_576 && freeBytes >= fileBytes / 10;
}

const num = (r: { rows: Record<string, unknown>[] }) =>
  Number(Object.values(r.rows[0] ?? {})[0] ?? 0);

async function rebuildVectors(d: DB, table: string) {
  await d.transaction(async (tx) => {
    await tx.execute(`CREATE TEMP TABLE IF NOT EXISTS reclaim_keep (id INTEGER, embedding BLOB)`);
    await tx.execute('DELETE FROM temp.reclaim_keep');
    await tx.execute(`INSERT INTO temp.reclaim_keep SELECT id, embedding FROM ${table}`);
    await tx.execute(`DROP TABLE ${table}`);
    await tx.execute(vecTableSql(table));
    await tx.execute(
      `INSERT INTO ${table} (id, embedding) SELECT id, embedding FROM temp.reclaim_keep`,
    );
    await tx.execute('DROP TABLE temp.reclaim_keep');
  });
}

export type ReclaimResult = {
  rebuilt: string[];
  vacuumed: boolean;
  beforeBytes: number;
  afterBytes: number;
};

let running: Promise<ReclaimResult> | null = null;

/** force: after "delete everything" or a bulk delete the user is watching (storage shown). */
export function reclaimSpace(opts: { force?: boolean } = {}): Promise<ReclaimResult> {
  running ??= (async () => {
    try {
      const d = await getDb();
      const pageSize = num(await d.execute('SELECT page_size FROM pragma_page_size()'));
      const fileBytes = async () =>
        num(await d.execute('SELECT page_count FROM pragma_page_count()')) * pageSize;
      const beforeBytes = await fileBytes();
      const rebuilt: string[] = [];
      for (const t of VEC_TABLES) {
        const capacity = num(await d.execute(`SELECT COALESCE(SUM(size), 0) FROM ${t}_chunks`));
        const live = num(await d.execute(`SELECT COUNT(*) FROM ${t}_rowids`));
        if (needsRebuild(capacity, live, opts.force)) {
          await rebuildVectors(d, t);
          rebuilt.push(t);
        }
      }
      // Merges the word index's segments, dropping deleted words.
      await d.execute("INSERT INTO moments_fts(moments_fts) VALUES ('optimize')");
      const free =
        num(await d.execute('SELECT freelist_count FROM pragma_freelist_count()')) * pageSize;
      const vacuumed = vacuumWorthIt(free, await fileBytes(), opts.force);
      if (vacuumed) await d.execute('VACUUM');
      const afterBytes = await fileBytes();
      console.log(
        `[storage] reclaim: rebuilt ${rebuilt.join(', ') || 'none'}; ${vacuumed ? 'vacuumed; ' : ''}${Math.round(beforeBytes / 1024)} → ${Math.round(afterBytes / 1024)} KB`,
      );
      return { rebuilt, vacuumed, beforeBytes, afterBytes };
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** After deletes: one run a few seconds later, so a run of deletes is handled once. */
export function scheduleReclaim(delayMs = 5_000) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    reclaimSpace().catch((e) => console.log(`[storage] reclaim failed: ${String(e)}`));
  }, delayMs);
}

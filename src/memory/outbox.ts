/**
 * Actions waiting for the internet (an approved email when offline). Shown on the draft card as
 * "Waiting for internet" and sent when the phone is back online (engine/actions.ts). Messages
 * handed to WhatsApp, Messages etc. never wait here: those apps queue their own sends.
 */
import { getDb } from './db';

export type OutboxRow = {
  id: string;
  draft: string;
  tries: number;
  createdAt: number;
  lastError: string | null;
};

let ready = false;

async function db() {
  const d = await getDb();
  if (!ready) {
    await d.execute(`CREATE TABLE IF NOT EXISTS outbox (
       id TEXT PRIMARY KEY,
       draft TEXT NOT NULL,
       tries INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       last_error TEXT
     )`);
    ready = true;
  }
  return d;
}

export async function enqueue(id: string, draftJson: string, at = Date.now()) {
  const d = await db();
  await d.execute(
    'INSERT OR REPLACE INTO outbox (id, draft, tries, created_at) VALUES (?, ?, 0, ?)',
    [id, draftJson, at],
  );
}

export async function pending(): Promise<OutboxRow[]> {
  const d = await db();
  const r = await d.execute(
    'SELECT id, draft, tries, created_at, last_error FROM outbox ORDER BY created_at',
  );
  return r.rows.map((x) => ({
    id: x.id as string,
    draft: x.draft as string,
    tries: x.tries as number,
    createdAt: x.created_at as number,
    lastError: (x.last_error as string | null) ?? null,
  }));
}

export async function noteFailure(id: string, error: string) {
  const d = await db();
  await d.execute('UPDATE outbox SET tries = tries + 1, last_error = ? WHERE id = ?', [error, id]);
}

export async function remove(id: string) {
  const d = await db();
  await d.execute('DELETE FROM outbox WHERE id = ?', [id]);
}

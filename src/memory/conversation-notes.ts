/** Storage for automatic conversation notes (moments of kind 'conversation_note'). */
import { getDb } from './db';
import type { HeardLine } from './conversation-note-logic';
import { speakerLabel } from './people-logic';

export const NOTE_KIND = 'conversation_note';
const UNTIL_KEY = 'conversationNotes.until';
/** Older lines are not read (turning notes on doesn't write up last month). */
const LOOKBACK_MS = 2 * 86_400_000;

/** Up to when conversations have been handled (ms). */
export async function notesUntil(): Promise<number> {
  const db = await getDb();
  const r = await db.execute('SELECT value FROM meta WHERE key = ?', [UNTIL_KEY]);
  return Number(r.rows[0]?.value ?? 0);
}

export async function setNotesUntil(at: number) {
  const db = await getDb();
  await db.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    UNTIL_KEY,
    String(at),
  ]);
}

const toLine = (x: Record<string, unknown>): HeardLine => {
  const id = x.speaker_id as number | null;
  const isOwner = x.is_owner === 1;
  return {
    id: x.id as number,
    at: x.at as number,
    text: x.text as string,
    isOwner,
    who: isOwner
      ? 'Me'
      : id == null
        ? 'Someone'
        : speakerLabel({
            id,
            name: (x.name as string | null) ?? null,
            isOwner: false,
            labelNo: (x.label_no as number | null) ?? null,
            description: (x.description as string | null) ?? null,
          }),
  };
};

const LINE_SELECT = `SELECT m.id, m.at, m.text, m.speaker_id, s.name, s.is_owner, s.label_no, s.description
  FROM moments m LEFT JOIN speakers s ON s.id = m.speaker_id
  WHERE m.kind = 'speech' AND length(m.text) > 0`;

/** Kept speech after [after], oldest first (only kept lines: consent rules already applied). */
export async function heardLinesSince(after: number, now = Date.now()): Promise<HeardLine[]> {
  const db = await getDb();
  const r = await db.execute(`${LINE_SELECT} AND m.at > ? ORDER BY m.at LIMIT 2000`, [
    Math.max(after, now - LOOKBACK_MS),
  ]);
  return r.rows.map(toLine);
}

export async function saveNote(from: number, to: number, text: string): Promise<number> {
  const db = await getDb();
  const r = await db.execute('INSERT INTO moments (kind, at, text, from_at) VALUES (?, ?, ?, ?)', [
    NOTE_KIND,
    to,
    text,
    from,
  ]);
  return r.insertId!;
}

export type StoredNote = { id: number; from: number; to: number; text: string };

export async function getNote(id: number): Promise<StoredNote | null> {
  const db = await getDb();
  const r = await db.execute(
    'SELECT id, at, from_at, text FROM moments WHERE id = ? AND kind = ?',
    [id, NOTE_KIND],
  );
  const x = r.rows[0];
  if (!x) return null;
  return {
    id,
    from: (x.from_at as number | null) ?? (x.at as number),
    to: x.at as number,
    text: x.text as string,
  };
}

/** Notes that ended between [from] and [to], oldest first. */
export async function notesBetween(from: number, to: number): Promise<StoredNote[]> {
  const db = await getDb();
  const r = await db.execute(
    'SELECT id, at, from_at, text FROM moments WHERE kind = ? AND at >= ? AND at < ? ORDER BY at',
    [NOTE_KIND, from, to],
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    from: (x.from_at as number | null) ?? (x.at as number),
    to: x.at as number,
    text: x.text as string,
  }));
}

/** What was said during a note's conversation (for its page). */
export async function noteLines(n: StoredNote): Promise<HeardLine[]> {
  const db = await getDb();
  const r = await db.execute(`${LINE_SELECT} AND m.at >= ? AND m.at <= ? ORDER BY m.at LIMIT 500`, [
    n.from,
    n.to,
  ]);
  return r.rows.map(toLine);
}

import { type DB, open } from '@op-engineering/op-sqlite';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The encrypted memory database (SQLCipher). The key is random, made on first run, and kept in
 * the phone's secure keystore — it never leaves the device and isn't in backups.
 */
export const EMBED_DIMS = 256;
const KEY_NAME = 'sidekick.db.key';

/** A vec0 table of memory vectors (also used to rebuild one in reclaim.ts). */
export const vecTableSql = (name: string) =>
  `CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING vec0(
     id INTEGER PRIMARY KEY, embedding FLOAT[${EMBED_DIMS}] distance_metric=cosine
   )`;

let db: DB | null = null;

async function dbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return existing;
  const bytes = Crypto.getRandomBytes(32);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_NAME, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  return key;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS speakers (
     id INTEGER PRIMARY KEY,
     name TEXT,
     is_owner INTEGER NOT NULL DEFAULT 0,
     centroid TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 1,
     consented_at INTEGER
   )`,
  // One row per remembered moment: something said, asked, answered, or photographed.
  `CREATE TABLE IF NOT EXISTS moments (
     id INTEGER PRIMARY KEY,
     kind TEXT NOT NULL,
     at INTEGER NOT NULL,
     text TEXT NOT NULL DEFAULT '',
     speaker_id INTEGER REFERENCES speakers(id) ON DELETE SET NULL,
     photo_path TEXT,
     embedded INTEGER NOT NULL DEFAULT 0
   )`,
  'CREATE INDEX IF NOT EXISTS moments_at ON moments(at)',
  `CREATE VIRTUAL TABLE IF NOT EXISTS moments_fts USING fts5(text, content='moments', content_rowid='id')`,
  `CREATE TRIGGER IF NOT EXISTS moments_ai AFTER INSERT ON moments BEGIN
     INSERT INTO moments_fts(rowid, text) VALUES (new.id, new.text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS moments_ad AFTER DELETE ON moments BEGIN
     INSERT INTO moments_fts(moments_fts, rowid, text) VALUES ('delete', old.id, old.text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS moments_au AFTER UPDATE OF text ON moments BEGIN
     INSERT INTO moments_fts(moments_fts, rowid, text) VALUES ('delete', old.id, old.text);
     INSERT INTO moments_fts(rowid, text) VALUES (new.id, new.text);
   END`,
  vecTableSql('moments_vec'),
  // Photo vectors from the same embedder (text and photos share one space). Text questions
  // search both tables; a photo is findable by what it shows before its text is read.
  vecTableSql('photos_vec'),
  // Phone search (gallery.ts): photos the user allowed (Photos library, picked folders). Only the
  // index lives here (date, place, the text read from the photo, a vector); the photo stays where
  // it is. key: the library id or the picked file's URI; state: 0 to read, 1 read, 2 can't read.
  `CREATE TABLE IF NOT EXISTS gallery (
     id INTEGER PRIMARY KEY,
     key TEXT NOT NULL UNIQUE,
     origin TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     at INTEGER NOT NULL,
     ver TEXT NOT NULL DEFAULT '',
     text TEXT NOT NULL DEFAULT '',
     place TEXT,
     lat REAL,
     lon REAL,
     state INTEGER NOT NULL DEFAULT 0
   )`,
  'CREATE INDEX IF NOT EXISTS gallery_at ON gallery(at)',
  'CREATE INDEX IF NOT EXISTS gallery_state ON gallery(state, at)',
  `CREATE VIRTUAL TABLE IF NOT EXISTS gallery_fts USING fts5(text, content='gallery', content_rowid='id')`,
  `CREATE TRIGGER IF NOT EXISTS gallery_ai AFTER INSERT ON gallery BEGIN
     INSERT INTO gallery_fts(rowid, text) VALUES (new.id, new.text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS gallery_ad AFTER DELETE ON gallery BEGIN
     INSERT INTO gallery_fts(gallery_fts, rowid, text) VALUES ('delete', old.id, old.text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS gallery_au AFTER UPDATE OF text ON gallery BEGIN
     INSERT INTO gallery_fts(gallery_fts, rowid, text) VALUES ('delete', old.id, old.text);
     INSERT INTO gallery_fts(rowid, text) VALUES (new.id, new.text);
   END`,
  vecTableSql('gallery_vec'),
  // Small key/value store, e.g. which embedder file made the stored vectors.
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  // Things the user told Sidekick to remember (saved) or it guessed (suggested, needs approval).
  `CREATE TABLE IF NOT EXISTS facts (
     id INTEGER PRIMARY KEY,
     text TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('saved', 'suggested')),
     at INTEGER NOT NULL
   )`,
  // Who was around when a photo was captured (voices heard in the minutes before).
  `CREATE TABLE IF NOT EXISTS moment_people (
     moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
     speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
     PRIMARY KEY (moment_id, speaker_id)
   )`,
  // Photos whose visible text + scene have been read into the moment text (once each).
  `CREATE TABLE IF NOT EXISTS photo_descriptions (
     moment_id INTEGER PRIMARY KEY REFERENCES moments(id) ON DELETE CASCADE,
     at INTEGER NOT NULL
   )`,
  // The phone's contacts, when the user turns that source on (names + numbers; see sources.ts).
  `CREATE TABLE IF NOT EXISTS contacts (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     phones TEXT NOT NULL DEFAULT '[]'
   )`,
  // To-dos, events and reminders proposed from what was said (suggested) until the user approves.
  `CREATE TABLE IF NOT EXISTS followups (
     id INTEGER PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('todo', 'event', 'reminder')),
     title TEXT NOT NULL,
     due_at INTEGER,
     all_day INTEGER NOT NULL DEFAULT 0,
     when_text TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL CHECK (status IN ('suggested', 'approved', 'done', 'dismissed')),
     created_at INTEGER NOT NULL,
     source_moment_id INTEGER REFERENCES moments(id) ON DELETE SET NULL
   )`,
];

/**
 * Columns added after the first release. Each is added once if missing (idempotent), so any
 * feature can append here without a version number.
 */
export const MIGRATIONS: { table: string; column: string; ddl: string; after?: string }[] = [
  {
    table: 'speakers',
    column: 'suggested_name',
    ddl: 'ALTER TABLE speakers ADD COLUMN suggested_name TEXT',
  },
  {
    table: 'speakers',
    column: 'suggested_count',
    ddl: 'ALTER TABLE speakers ADD COLUMN suggested_count INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: 'speakers',
    column: 'dismissed_names',
    ddl: "ALTER TABLE speakers ADD COLUMN dismissed_names TEXT NOT NULL DEFAULT ''",
  },
  {
    table: 'moments',
    column: 'facts_scanned',
    ddl: 'ALTER TABLE moments ADD COLUMN facts_scanned INTEGER NOT NULL DEFAULT 0',
  },
  // Where it happened (when location is allowed): coordinates and offline place name.
  { table: 'moments', column: 'lat', ddl: 'ALTER TABLE moments ADD COLUMN lat REAL' },
  { table: 'moments', column: 'lon', ddl: 'ALTER TABLE moments ADD COLUMN lon REAL' },
  { table: 'moments', column: 'place', ddl: 'ALTER TABLE moments ADD COLUMN place TEXT' },
  // Photo moments: 1 once the photo itself has a vector in photos_vec.
  {
    table: 'moments',
    column: 'image_embedded',
    ddl: 'ALTER TABLE moments ADD COLUMN image_embedded INTEGER NOT NULL DEFAULT 0',
  },
  // Imported moments (files, calendar, notifications): a stable key per item and its version,
  // so a re-scan updates or removes it instead of adding a copy.
  { table: 'moments', column: 'source_key', ddl: 'ALTER TABLE moments ADD COLUMN source_key TEXT' },
  { table: 'moments', column: 'source_ver', ddl: 'ALTER TABLE moments ADD COLUMN source_ver TEXT' },
  // 1 once the line has been read for follow-ups (to-dos, events, reminders).
  {
    table: 'moments',
    column: 'followups_scanned',
    ddl: 'ALTER TABLE moments ADD COLUMN followups_scanned INTEGER NOT NULL DEFAULT 0',
  },
  // Photo moments: OCR state (0 not read, 1 no text found, 2 text added as a "Read:" line).
  {
    table: 'moments',
    column: 'photo_ocr',
    ddl: 'ALTER TABLE moments ADD COLUMN photo_ocr INTEGER NOT NULL DEFAULT 0',
  },
  // People: a stable automatic label per voice ("Person 3"), names applied automatically from
  // "my name is Sam" (name_auto = 1 until the user confirms or renames), and the user's notes.
  {
    table: 'speakers',
    column: 'label_no',
    ddl: 'ALTER TABLE speakers ADD COLUMN label_no INTEGER',
    after:
      'UPDATE speakers SET label_no = (SELECT COUNT(*) FROM speakers s2 WHERE s2.is_owner = 0 AND s2.id <= speakers.id) WHERE is_owner = 0',
  },
  {
    table: 'speakers',
    column: 'name_auto',
    ddl: 'ALTER TABLE speakers ADD COLUMN name_auto INTEGER NOT NULL DEFAULT 0',
  },
  {
    table: 'speakers',
    column: 'notes',
    ddl: "ALTER TABLE speakers ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
  },
  // A fact about another person (from what they said), shown and approved on their page.
  {
    table: 'facts',
    column: 'speaker_id',
    ddl: 'ALTER TABLE facts ADD COLUMN speaker_id INTEGER REFERENCES speakers(id) ON DELETE CASCADE',
  },
  // "Sam, can you send the report": the follow-up is linked to the person it was asked of.
  {
    table: 'followups',
    column: 'person_id',
    ddl: 'ALTER TABLE followups ADD COLUMN person_id INTEGER REFERENCES speakers(id) ON DELETE SET NULL',
  },
  // What an unnamed voice seems to be from context ("Waiter", "Bus driver"), set by the model.
  {
    table: 'speakers',
    column: 'description',
    ddl: 'ALTER TABLE speakers ADD COLUMN description TEXT',
  },
  // The saved audio of a speech line (Opus), played back from the chat and Memory.
  { table: 'moments', column: 'audio_path', ddl: 'ALTER TABLE moments ADD COLUMN audio_path TEXT' },
  // Recurring reminders ("every Monday at 9"): repeat-logic.ts rule, null = once.
  { table: 'followups', column: 'repeat', ddl: 'ALTER TABLE followups ADD COLUMN repeat TEXT' },
  // A conversation note (kind 'conversation_note', at = its end): when the conversation began.
  { table: 'moments', column: 'from_at', ddl: 'ALTER TABLE moments ADD COLUMN from_at INTEGER' },
  // "Understand other languages": the language a heard line is in once checked ('en' = English or
  // unsure, else the ISO code of a line that now carries its English translation). Null = unchecked.
  { table: 'moments', column: 'lang', ddl: 'ALTER TABLE moments ADD COLUMN lang TEXT' },
  // A person fact waiting for the model's private-topic check (0) before it is suggested (1).
  {
    table: 'facts',
    column: 'checked',
    ddl: 'ALTER TABLE facts ADD COLUMN checked INTEGER NOT NULL DEFAULT 1',
  },
];

function migrate(d: DB) {
  for (const m of MIGRATIONS) {
    const cols = d.executeSync(`PRAGMA table_info(${m.table})`).rows.map((r) => r.name);
    if (cols.includes(m.column)) continue;
    d.executeSync(m.ddl);
    // One-off backfill for rows that existed before the column.
    if (m.after) d.executeSync(m.after);
  }
}

export async function getDb(): Promise<DB> {
  if (db) return db;
  const location = iosDbFolder();
  const d = open({
    name: 'memory.db',
    encryptionKey: await dbKey(),
    ...(location ? { location } : {}),
  });
  d.executeSync('PRAGMA foreign_keys = ON');
  // Deleted memories are zeroed in the file, not just unlinked (reclaim.ts).
  d.executeSync('PRAGMA secure_delete = ON');
  for (const sql of SCHEMA) d.executeSync(sql);
  migrate(d);
  db = d;
  return d;
}

/**
 * iPhone: op-sqlite's default folder (Library) is copied by iCloud and computer backups, so the
 * database goes in Sidekick's own folder, which the native module keeps out of backups (Android:
 * backups are off for the app). There are no older iPhone installs to move.
 */
function iosDbFolder(): string | undefined {
  if (Platform.OS !== 'ios') return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const n = require('../../modules/sidekick-native').default as {
      getDeviceInfo(): { filesDir: string };
    };
    return `${n.getDeviceInfo().filesDir}/data`;
  } catch {
    return undefined;
  }
}

/** Closes the database (before "Delete all my data" removes its file). */
export function closeDb() {
  try {
    db?.close();
  } catch {
    // Already closed.
  }
  db = null;
}

export function vecParam(v: number[]): Float32Array {
  return Float32Array.from(v);
}

import { type DB, open } from '@op-engineering/op-sqlite';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { notices } from '@/engine/notices';

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
/** The one open in progress: every early caller waits for it (see getDb). */
let opening: Promise<DB> | null = null;
/** Set before "Delete all my data" wipes the file: nothing may open (and so re-create) it again. */
let closedForGood = false;

/** SQLITE_NOTADB: the file is not readable with this key (it was made with another one). */
const NOT_A_DB = 26;

async function newKey(): Promise<string> {
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

/**
 * The database, opened once. Many parts of the app ask for it at start-up at the same moment, so
 * they all share one open: two opens at once used to make two different keys on the very first
 * run (the file was then unreadable at the next start, "file is not a database") and two
 * connections that locked each other ("database is locked").
 */
export function getDb(): Promise<DB> {
  if (db) return Promise.resolve(db);
  if (closedForGood) return Promise.reject(new Error('The memory database is being deleted.'));
  if (!opening) {
    opening = openDb().finally(() => {
      opening = null;
    });
  }
  return opening;
}

async function openDb(): Promise<DB> {
  const location = iosDbFolder();
  const where = location ? { location } : {};
  const key = (await SecureStore.getItemAsync(KEY_NAME)) ?? (await newKey());
  let d = open({ name: 'memory.db', encryptionKey: key, ...where });
  if (!readable(d)) {
    // A file this key can't read is lost for good (its key is gone: a first-run race in an older
    // build, or a wipe that was interrupted). It is set aside, not deleted, and a fresh memory
    // starts, instead of every later step failing with a database error.
    const path = d.getDbPath();
    try {
      d.close();
    } catch {
      // Not open.
    }
    setAside(path);
    d = open({ name: 'memory.db', encryptionKey: key, ...where });
    if (!readable(d)) throw new Error('The new memory file could not be opened either.');
    console.log('[db] the old memory file could not be read with its key; started a new one');
    notices.post({
      key: 'memory-reset',
      kind: 'info',
      text: "Your earlier memories couldn't be opened, so Sidekick started a new memory.",
    });
  }
  d.executeSync('PRAGMA foreign_keys = ON');
  // Deleted memories are zeroed in the file, not just unlinked (reclaim.ts).
  d.executeSync('PRAGMA secure_delete = ON');
  // A second connection (if one is ever opened) waits for a lock instead of failing at once.
  d.executeSync('PRAGMA busy_timeout = 5000');
  for (const sql of SCHEMA) d.executeSync(sql);
  migrate(d);
  db = d;
  return d;
}

/** Whether the key opens the file (a new, empty file always opens). */
function readable(d: DB): boolean {
  try {
    d.executeSync('SELECT count(*) FROM sqlite_master');
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === NOT_A_DB || /not a database/i.test(String(e)))
      return false;
    throw e;
  }
}

/**
 * Moves the file aside with its journal files: a -wal or -shm left behind belongs to the old key
 * and makes the new file unreadable too. The path is encoded: on iPhone it is under "Application
 * Support", and a bare space made the move miss the file (seen in the iPhone Simulator).
 */
function setAside(path: string) {
  const stamp = Date.now();
  const uri = (p: string) => `file://${encodeURI(p)}`;
  const moved: string[] = [];
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const from = uri(`${path}${suffix}`);
    try {
      const f = new File(from);
      if (!f.exists) continue;
      f.move(new File(uri(`${path}.unreadable-${stamp}${suffix}`)));
      moved.push(suffix || 'db');
    } catch (e) {
      console.log(`[db] could not set ${suffix || 'the file'} aside: ${String(e)}`);
      try {
        new File(from).delete();
      } catch {
        // Nothing more to do: the open below reports it.
      }
    }
  }
  console.log(`[db] set aside: ${moved.join(', ') || 'nothing'}`);
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

/**
 * Closes the database before "Delete all my data" removes its file. Nothing opens it again until
 * the app restarts: an open racing the wipe re-created the file with the key being deleted, and
 * the next start could never read it.
 */
export function closeDb() {
  closedForGood = true;
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

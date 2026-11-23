import { type DB, open } from '@op-engineering/op-sqlite';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * The encrypted memory database (SQLCipher). The key is random, made on first run, and kept in
 * the phone's secure keystore — it never leaves the device and isn't in backups.
 */
export const EMBED_DIMS = 256;
const KEY_NAME = 'sidekick.db.key';

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
  `CREATE VIRTUAL TABLE IF NOT EXISTS moments_vec USING vec0(
     id INTEGER PRIMARY KEY, embedding FLOAT[${EMBED_DIMS}] distance_metric=cosine
   )`,
  // Things the user told Sidekick to remember (saved) or it guessed (suggested, needs approval).
  `CREATE TABLE IF NOT EXISTS facts (
     id INTEGER PRIMARY KEY,
     text TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('saved', 'suggested')),
     at INTEGER NOT NULL
   )`,
];

export async function getDb(): Promise<DB> {
  if (db) return db;
  const d = open({ name: 'memory.db', encryptionKey: await dbKey() });
  d.executeSync('PRAGMA foreign_keys = ON');
  for (const sql of SCHEMA) d.executeSync(sql);
  db = d;
  return d;
}

export function vecParam(v: number[]): Float32Array {
  return Float32Array.from(v);
}

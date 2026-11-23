import SidekickNative, { type JournalEntry } from '../../modules/sidekick-native';
import { isDownloaded, modelPath } from '@/engine/downloads';
import { EMBEDDER_FILE } from '@/engine/models';
import { dataDir } from '@/engine/paths';
import { getSettings } from '@/engine/settings';
import { isAgreement, isConsentQuestion, CONSENT_WINDOW_MS, keepOtherSpeech } from './consent';
import { EMBED_DIMS, getDb, vecParam } from './db';
import { embedDocument, embedQuery, ftsQuery, fuseRankings, timeWindow } from './search-logic';
import { addToCentroid, matchSpeaker, type Speaker } from './voices';

export type Moment = {
  id: number;
  kind: string;
  at: number;
  text: string;
  speakerId: number | null;
  speakerName: string | null;
  isOwner: boolean;
  photoPath: string | null;
};

type Row = Record<string, unknown>;
const toMoment = (r: Row): Moment => ({
  id: r.id as number,
  kind: r.kind as string,
  at: r.at as number,
  text: r.text as string,
  speakerId: (r.speaker_id as number | null) ?? null,
  speakerName: (r.name as string | null) ?? null,
  isOwner: r.is_owner === 1,
  photoPath: (r.photo_path as string | null) ?? null,
});

async function speakers(): Promise<Speaker[]> {
  const db = await getDb();
  const r = await db.execute('SELECT id, centroid, count, is_owner FROM speakers');
  return r.rows.map((x) => ({
    id: x.id as number,
    centroid: JSON.parse(x.centroid as string),
    count: x.count as number,
    isOwner: x.is_owner === 1,
  }));
}

/** Finds (and learns) who is speaking. Owner clips teach the owner's voice. */
async function assignSpeaker(voice: number[] | null, owner: boolean): Promise<Speaker | null> {
  if (!voice) return null;
  const db = await getDb();
  const all = await speakers();
  let s = owner ? (all.find((x) => x.isOwner) ?? null) : matchSpeaker(voice, all);
  if (s) {
    const c = addToCentroid(s, voice);
    await db.execute('UPDATE speakers SET centroid = ?, count = count + 1 WHERE id = ?', [
      JSON.stringify(c),
      s.id,
    ]);
    return s;
  }
  const r = await db.execute('INSERT INTO speakers (is_owner, centroid) VALUES (?, ?)', [
    owner ? 1 : 0,
    JSON.stringify(voice),
  ]);
  s = { id: r.insertId!, centroid: voice, count: 1, isOwner: owner };
  return s;
}

/** A push-to-talk clip is always the owner: use it to learn their voice. */
export async function learnOwnerVoice(voice: number[]) {
  await assignSpeaker(voice, true);
}

let lastConsentAsk = 0;

/** Moves everything the listener heard into memory, applying consent rules. */
export async function ingestJournal(): Promise<number> {
  const lines = SidekickNative.journalDrain();
  if (!lines.length) return 0;
  const db = await getDb();
  const { consentMode } = getSettings();
  let added = 0;
  for (const line of lines) {
    let e: JournalEntry;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.kind === 'answer') {
      await db.execute('INSERT INTO moments (kind, at, text) VALUES (?, ?, ?)', [
        'answer',
        e.at,
        `Q: ${e.question}\nA: ${e.text}`,
      ]);
      added++;
      continue;
    }
    const s = await assignSpeaker(e.voice, e.owner);
    const isOwner = e.owner || s?.isOwner === true;
    if (isOwner && isConsentQuestion(e.text)) lastConsentAsk = e.at;
    if (!isOwner) {
      let consented = false;
      if (s) {
        const row = await db.execute('SELECT consented_at FROM speakers WHERE id = ?', [s.id]);
        consented = row.rows[0]?.consented_at != null;
        if (!consented && e.at - lastConsentAsk < CONSENT_WINDOW_MS && isAgreement(e.text)) {
          await db.execute('UPDATE speakers SET consented_at = ? WHERE id = ?', [e.at, s.id]);
          consented = true;
        }
      }
      if (!keepOtherSpeech({ consentMode, speakerConsented: consented })) continue;
    }
    await db.execute('INSERT INTO moments (kind, at, text, speaker_id) VALUES (?, ?, ?, ?)', [
      e.kind,
      e.at,
      e.text,
      s?.id ?? null,
    ]);
    added++;
  }
  return added;
}

/** Saves a photo question: the original image is kept so detail questions can re-read it. */
export async function rememberPhotoQuestion(tmpPhoto: string, question: string, answer: string) {
  const db = await getDb();
  const at = Date.now();
  let photoPath: string | null = null;
  if (getSettings().rememberPhotos) {
    photoPath = `${dataDir()}/photos/${at}.jpg`;
    SidekickNative.copyFile(tmpPhoto, photoPath);
  }
  await db.execute('INSERT INTO moments (kind, at, text, photo_path) VALUES (?, ?, ?, ?)', [
    'photo',
    at,
    `Q: ${question}\nA: ${answer}`,
    photoPath,
  ]);
}

export async function rememberExchange(question: string, answer: string) {
  const db = await getDb();
  await db.execute('INSERT INTO moments (kind, at, text) VALUES (?, ?, ?)', [
    'answer',
    Date.now(),
    `Q: ${question}\nA: ${answer}`,
  ]);
}

export async function saveFact(text: string, status: 'saved' | 'suggested' = 'saved') {
  const db = await getDb();
  await db.execute('INSERT INTO facts (text, status, at) VALUES (?, ?, ?)', [
    text,
    status,
    Date.now(),
  ]);
}

/** Embeds moments that don't have a vector yet. Call when the phone is otherwise idle. */
export async function embedPending(limit = 64): Promise<number> {
  if (!isDownloaded(EMBEDDER_FILE)) return 0;
  const db = await getDb();
  const r = await db.execute(
    "SELECT id, text FROM moments WHERE embedded = 0 AND text != '' ORDER BY id LIMIT ?",
    [limit],
  );
  if (!r.rows.length) return 0;
  const vecs = await SidekickNative.embed(
    modelPath(EMBEDDER_FILE),
    r.rows.map((x) => embedDocument(x.text as string)),
    EMBED_DIMS,
  );
  await db.transaction(async (tx) => {
    for (let i = 0; i < r.rows.length; i++) {
      await tx.execute('INSERT OR REPLACE INTO moments_vec (id, embedding) VALUES (?, ?)', [
        r.rows[i].id as number,
        vecParam(vecs[i]),
      ]);
      await tx.execute('UPDATE moments SET embedded = 1 WHERE id = ?', [r.rows[i].id as number]);
    }
  });
  return r.rows.length;
}

const MOMENT_SELECT =
  'SELECT m.*, s.name, s.is_owner FROM moments m LEFT JOIN speakers s ON s.id = m.speaker_id';

/** Hybrid search: meaning (vectors) + exact words (FTS5), narrowed by time words in the question. */
export async function searchMemory(question: string, k = 8, now = new Date()): Promise<Moment[]> {
  const db = await getDb();
  const win = timeWindow(question, now);
  const lists: number[][] = [];
  if (isDownloaded(EMBEDDER_FILE)) {
    try {
      const [qv] = await SidekickNative.embed(
        modelPath(EMBEDDER_FILE),
        [embedQuery(question)],
        EMBED_DIMS,
      );
      const r = await db.execute(
        'SELECT id FROM moments_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance',
        [vecParam(qv), win ? 200 : k * 3],
      );
      lists.push(r.rows.map((x) => x.id as number));
    } catch (e) {
      console.log(`[memory] vector search failed: ${String(e)}`);
    }
  }
  const fq = ftsQuery(question);
  if (fq) {
    const r = await db.execute(
      'SELECT rowid AS id FROM moments_fts WHERE moments_fts MATCH ? ORDER BY rank LIMIT ?',
      [fq, k * 3],
    );
    lists.push(r.rows.map((x) => x.id as number));
  }
  console.log(`[memory] search: vector ${lists[0]?.length ?? 0}, words ${lists[1]?.length ?? 0}`);
  let ids = fuseRankings(lists);
  if (win) {
    const r = await db.execute('SELECT id FROM moments WHERE at >= ? AND at < ? ORDER BY at DESC', [
      win.from,
      win.to,
    ]);
    const inWin = new Set(r.rows.map((x) => x.id as number));
    const ranked = ids.filter((id) => inWin.has(id));
    // Nothing matched by content inside the window: fall back to the window's most recent moments.
    ids = ranked.length ? ranked : [...inWin];
  }
  ids = ids.slice(0, k);
  if (!ids.length) return [];
  const r = await db.execute(
    `${MOMENT_SELECT} WHERE m.id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const byId = new Map(r.rows.map((x) => [x.id as number, toMoment(x)]));
  return ids.map((id) => byId.get(id)).filter((m): m is Moment => !!m);
}

export async function recentMoments(limit = 100, offset = 0): Promise<Moment[]> {
  const db = await getDb();
  const r = await db.execute(`${MOMENT_SELECT} ORDER BY m.at DESC LIMIT ? OFFSET ?`, [
    limit,
    offset,
  ]);
  return r.rows.map(toMoment);
}

export async function savedFacts(): Promise<{ id: number; text: string; status: string }[]> {
  const db = await getDb();
  const r = await db.execute('SELECT id, text, status FROM facts ORDER BY at DESC');
  return r.rows.map((x) => ({
    id: x.id as number,
    text: x.text as string,
    status: x.status as string,
  }));
}

export async function listSpeakers() {
  const db = await getDb();
  const r = await db.execute(
    'SELECT s.id, s.name, s.is_owner, s.consented_at, COUNT(m.id) AS n FROM speakers s LEFT JOIN moments m ON m.speaker_id = s.id GROUP BY s.id ORDER BY n DESC',
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    name: (x.name as string | null) ?? null,
    isOwner: x.is_owner === 1,
    consented: x.consented_at != null,
    moments: x.n as number,
  }));
}

export async function nameSpeaker(id: number, name: string) {
  const db = await getDb();
  await db.execute('UPDATE speakers SET name = ? WHERE id = ?', [name.trim() || null, id]);
}

// --- Deleting ---

async function deletePhotos(where: string, params: (number | string)[]) {
  const db = await getDb();
  const r = await db.execute(
    `SELECT photo_path FROM moments WHERE photo_path IS NOT NULL AND ${where}`,
    params,
  );
  r.rows.forEach((x) => SidekickNative.deleteFile(x.photo_path as string));
}

async function deleteMoments(where: string, params: (number | string)[]) {
  const db = await getDb();
  await deletePhotos(where, params);
  await db.execute(
    `DELETE FROM moments_vec WHERE id IN (SELECT id FROM moments WHERE ${where})`,
    params,
  );
  await db.execute(`DELETE FROM moments WHERE ${where}`, params);
}

export const deleteMoment = (id: number) => deleteMoments('id = ?', [id]);
export const deleteRange = (from: number, to: number) =>
  deleteMoments('at >= ? AND at < ?', [from, to]);

export async function deleteSpeaker(id: number) {
  await deleteMoments('speaker_id = ?', [id]);
  const db = await getDb();
  await db.execute('DELETE FROM speakers WHERE id = ?', [id]);
}

export async function deleteFact(id: number) {
  const db = await getDb();
  await db.execute('DELETE FROM facts WHERE id = ?', [id]);
}

export async function deleteEverything() {
  SidekickNative.journalDrain();
  await deleteMoments('1 = 1', []);
  const db = await getDb();
  await db.execute('DELETE FROM speakers');
  await db.execute('DELETE FROM facts');
}

/** Applies the retention setting. */
export async function applyRetention(now = Date.now()) {
  const days = getSettings().retentionDays;
  if (days > 0) await deleteMoments('at < ?', [now - days * 86_400_000]);
}

/** Everything as JSON + original photos in one zip; returns the file path. */
export async function exportEverything(): Promise<string> {
  const db = await getDb();
  const moments = (
    await db.execute('SELECT id, kind, at, text, speaker_id, photo_path FROM moments ORDER BY at')
  ).rows;
  const people = (await db.execute('SELECT id, name, is_owner, consented_at FROM speakers')).rows;
  const facts = (await db.execute('SELECT id, text, status, at FROM facts')).rows;
  const json = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      moments: moments.map((m) => ({
        ...m,
        photo_path: m.photo_path ? `photos/${String(m.photo_path).split('/').pop()}` : null,
      })),
      people,
      facts,
    },
    null,
    2,
  );
  const photos = moments.map((m) => m.photo_path as string | null).filter((p): p is string => !!p);
  const dest = `${SidekickNative.getDeviceInfo().filesDir}/exports/sidekick-export-${Date.now()}.zip`;
  return SidekickNative.exportZip(json, photos, dest);
}

import SidekickNative, { type JournalEntry } from '../../modules/sidekick-native';
import { isDownloaded, modelPath } from '@/engine/downloads';
import { EMBEDDER_FILE } from '@/engine/models';
import { dataDir } from '@/engine/paths';
import { here, placeName } from '@/engine/places';
import { consentModeNow } from '@/engine/region';
import { getSettings } from '@/engine/settings';
import { isAgreement, isConsentQuestion, CONSENT_WINDOW_MS, keepOtherSpeech } from './consent';
import { EMBED_DIMS, getDb, vecParam } from './db';
import { appendSeen, captureText } from './photo-text';
import { embedDocument, embedQuery, ftsQuery, fuseRankings, timeWindow } from './search-logic';
import { addresseeOf, findNameCues, ADDRESS_WINDOW_MS } from './names';
import { addToCentroid, cosine, matchSpeaker, type Speaker } from './voices';

export type Moment = {
  id: number;
  kind: string;
  at: number;
  text: string;
  speakerId: number | null;
  speakerName: string | null;
  isOwner: boolean;
  photoPath: string | null;
  /** For captured photos: who was heard nearby. */
  withPeople?: string[];
  /** Offline place name ("Leeds, GB") when location was on. */
  place: string | null;
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
  place: (r.place as string | null) ?? null,
});

/** Stores where a moment happened (coordinates + offline place name). */
async function tagPlace(id: number, p: { lat: number; lon: number } | null) {
  if (!p) return;
  const db = await getDb();
  await db.execute('UPDATE moments SET lat = ?, lon = ?, place = ? WHERE id = ?', [
    p.lat,
    p.lon,
    placeName(p),
    id,
  ]);
}

const entryPlace = (e: { lat?: number; lon?: number }) =>
  e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null;

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
  console.log(
    `[voice] ${owner ? 'owner clip' : 'clip'} sims: ${all.map((x) => `${x.id}${x.isOwner ? '*' : ''}=${cosine(voice, x.centroid).toFixed(2)}`).join(' ')}`,
  );
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
  const consentMode = consentModeNow();
  let added = 0;
  const kept: { at: number; speakerId: number | null; isOwner: boolean; text: string }[] = [];
  for (const line of lines) {
    let e: JournalEntry;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.kind === 'answer') {
      const r = await db.execute('INSERT INTO moments (kind, at, text) VALUES (?, ?, ?)', [
        'answer',
        e.at,
        `Q: ${e.question}\nA: ${e.text}`,
      ]);
      await tagPlace(r.insertId!, entryPlace(e));
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
    const ins = await db.execute(
      'INSERT INTO moments (kind, at, text, speaker_id) VALUES (?, ?, ?, ?)',
      [e.kind, e.at, e.text, s?.id ?? null],
    );
    await tagPlace(ins.insertId!, entryPlace(e));
    kept.push({ at: e.at, speakerId: s?.id ?? null, isOwner, text: e.text });
    added++;
  }
  try {
    await suggestNamesFrom(kept);
  } catch (err) {
    console.log(`[memory] name suggestions failed: ${String(err)}`);
  }
  return added;
}

// --- Names ---

/** Looks for "I'm Sam" / "thanks, Sam" in newly kept lines and records name suggestions. */
async function suggestNamesFrom(
  lines: { at: number; speakerId: number | null; isOwner: boolean; text: string }[],
) {
  const db = await getDb();
  for (const line of lines) {
    for (const cue of findNameCues(line.text)) {
      let target: number | null = null;
      if (cue.who === 'speaker') {
        target = line.isOwner ? null : line.speakerId;
      } else {
        const r = await db.execute(
          'SELECT m.at, m.speaker_id, s.is_owner FROM moments m JOIN speakers s ON s.id = m.speaker_id WHERE m.at BETWEEN ? AND ?',
          [line.at - ADDRESS_WINDOW_MS, line.at + ADDRESS_WINDOW_MS],
        );
        target = addresseeOf(
          line,
          r.rows.map((x) => ({
            at: x.at as number,
            speakerId: x.speaker_id as number,
            isOwner: x.is_owner === 1,
          })),
        );
      }
      if (target != null) await suggestName(target, cue.name);
    }
  }
}

async function suggestName(speakerId: number, name: string) {
  const db = await getDb();
  const r = await db.execute(
    'SELECT name, is_owner, suggested_name, suggested_count, dismissed_names FROM speakers WHERE id = ?',
    [speakerId],
  );
  const row = r.rows[0];
  if (!row || row.name || row.is_owner === 1) return;
  const dismissed = String(row.dismissed_names ?? '').split('|');
  if (dismissed.includes(name)) return;
  if (row.suggested_name === name) {
    await db.execute('UPDATE speakers SET suggested_count = suggested_count + 1 WHERE id = ?', [
      speakerId,
    ]);
  } else if (!row.suggested_name || (row.suggested_count as number) <= 1) {
    // A different name with as much evidence replaces a one-off guess.
    await db.execute('UPDATE speakers SET suggested_name = ?, suggested_count = 1 WHERE id = ?', [
      name,
      speakerId,
    ]);
  }
}

/** "Is this Sam?" → yes. */
export async function acceptSuggestedName(speakerId: number) {
  const db = await getDb();
  await db.execute(
    'UPDATE speakers SET name = suggested_name, suggested_name = NULL, suggested_count = 0 WHERE id = ? AND suggested_name IS NOT NULL',
    [speakerId],
  );
}

/** "Is this Sam?" → no; never suggest that name for this voice again. */
export async function dismissSuggestedName(speakerId: number) {
  const db = await getDb();
  await db.execute(
    "UPDATE speakers SET dismissed_names = dismissed_names || '|' || suggested_name, suggested_name = NULL, suggested_count = 0 WHERE id = ? AND suggested_name IS NOT NULL",
    [speakerId],
  );
}

// --- Inferred facts ---

/** The owner's own lines not yet read for facts (oldest first). */
export async function ownerLinesToScan(limit: number): Promise<{ id: number; text: string }[]> {
  const db = await getDb();
  const r = await db.execute(
    "SELECT m.id, m.text FROM moments m JOIN speakers s ON s.id = m.speaker_id WHERE s.is_owner = 1 AND m.facts_scanned = 0 AND m.kind IN ('speech', 'question') AND length(m.text) > 0 ORDER BY m.at LIMIT ?",
    [limit],
  );
  return r.rows.map((x) => ({ id: x.id as number, text: x.text as string }));
}

export async function markFactsScanned(ids: number[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.execute(
    `UPDATE moments SET facts_scanned = 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
}

/** Saves model-proposed facts for approval, skipping ones already known. */
export async function suggestFacts(texts: string[]) {
  const known = new Set((await savedFacts()).map((f) => f.text.toLowerCase().replace(/\.$/, '')));
  for (const t of texts) {
    if (!known.has(t.toLowerCase().replace(/\.$/, ''))) await saveFact(t, 'suggested');
  }
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
  const r = await db.execute(
    'INSERT INTO moments (kind, at, text, photo_path) VALUES (?, ?, ?, ?)',
    ['photo', at, `Q: ${question}\nA: ${answer}`, photoPath],
  );
  await tagPlace(r.insertId!, here());
}

/**
 * Called with the id of every newly captured moment, e.g. to tag it with the place. Other
 * features register here instead of editing the capture code.
 */
export const afterMomentSaved: ((momentId: number) => Promise<void>)[] = [
  (id) => tagPlace(id, here()),
];

/** Voices heard this long before a capture count as "who was around". */
export const AROUND_MS = 2 * 60_000;

/**
 * One-tap capture: keeps the original photo (always — the user asked for it), with an optional
 * voice note, and records who was heard nearby in the last two minutes.
 */
export async function capturePhoto(
  tmpPhoto: string,
  note: string | null,
  at = Date.now(),
): Promise<number> {
  const db = await getDb();
  const photoPath = `${dataDir()}/photos/${at}.jpg`;
  SidekickNative.copyFile(tmpPhoto, photoPath);
  const r = await db.execute(
    'INSERT INTO moments (kind, at, text, photo_path) VALUES (?, ?, ?, ?)',
    ['photo', at, captureText(note), photoPath],
  );
  const id = r.insertId!;
  await db.execute(
    `INSERT OR IGNORE INTO moment_people (moment_id, speaker_id)
     SELECT DISTINCT ?, speaker_id FROM moments
     WHERE speaker_id IS NOT NULL AND at >= ? AND at <= ?`,
    [id, at - AROUND_MS, at],
  );
  for (const hook of afterMomentSaved) await hook(id).catch(() => {});
  return id;
}

/** Names of the people recorded as around a moment ("You" for the owner). */
export async function peopleAround(momentId: number): Promise<string[]> {
  const db = await getDb();
  const r = await db.execute(
    `SELECT s.id, s.name, s.is_owner FROM moment_people p JOIN speakers s ON s.id = p.speaker_id
     WHERE p.moment_id = ? ORDER BY s.is_owner DESC, s.id`,
    [momentId],
  );
  return r.rows.map((x) =>
    x.is_owner === 1 ? 'You' : ((x.name as string | null) ?? `Voice ${x.id as number}`),
  );
}

/** The newest saved photo that hasn't had its text and scene read yet. */
export async function nextUndescribedPhoto(): Promise<{ id: number; photoPath: string } | null> {
  const db = await getDb();
  const r = await db.execute(
    `SELECT m.id, m.photo_path FROM moments m
     LEFT JOIN photo_descriptions d ON d.moment_id = m.id
     WHERE m.photo_path IS NOT NULL AND d.moment_id IS NULL
     ORDER BY m.at DESC LIMIT 1`,
  );
  const row = r.rows[0];
  return row ? { id: row.id as number, photoPath: row.photo_path as string } : null;
}

/** Stores what was read from a photo (or marks it done with null), and queues re-embedding. */
export async function savePhotoDescription(momentId: number, description: string | null) {
  const db = await getDb();
  if (description) {
    const r = await db.execute('SELECT text FROM moments WHERE id = ?', [momentId]);
    const old = (r.rows[0]?.text as string | undefined) ?? '';
    await db.execute('UPDATE moments SET text = ?, embedded = 0 WHERE id = ?', [
      appendSeen(old, description),
      momentId,
    ]);
  }
  await db.execute('INSERT OR REPLACE INTO photo_descriptions (moment_id, at) VALUES (?, ?)', [
    momentId,
    Date.now(),
  ]);
}

export async function rememberExchange(question: string, answer: string) {
  const db = await getDb();
  const r = await db.execute('INSERT INTO moments (kind, at, text) VALUES (?, ?, ?)', [
    'answer',
    Date.now(),
    `Q: ${question}\nA: ${answer}`,
  ]);
  await tagPlace(r.insertId!, here());
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
    "SELECT id, text, place FROM moments WHERE embedded = 0 AND text != '' ORDER BY id LIMIT ?",
    [limit],
  );
  if (!r.rows.length) return 0;
  const vecs = await SidekickNative.embed(
    modelPath(EMBEDDER_FILE),
    r.rows.map((x) =>
      embedDocument(x.place ? `${x.text as string} (in ${x.place as string})` : (x.text as string)),
    ),
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
  ids = ids.slice(0, k * 3);
  if (!ids.length) return [];
  const r = await db.execute(
    `${MOMENT_SELECT} WHERE m.id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const byId = new Map(r.rows.map((x) => [x.id as number, toMoment(x)]));
  // Sidekick's own text answers are not evidence: recalling them makes an old "I don't know"
  // (or an old mistake) repeat itself. Photo answers stay, since they describe what was seen.
  const found = ids
    .map((id) => byId.get(id))
    .filter((m): m is Moment => !!m && m.kind !== 'answer')
    .slice(0, k);
  for (const m of found) if (m.kind === 'photo') m.withPeople = await peopleAround(m.id);
  return found;
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
    'SELECT s.id, s.name, s.is_owner, s.consented_at, s.suggested_name, COUNT(m.id) AS n FROM speakers s LEFT JOIN moments m ON m.speaker_id = s.id GROUP BY s.id ORDER BY n DESC',
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    name: (x.name as string | null) ?? null,
    isOwner: x.is_owner === 1,
    consented: x.consented_at != null,
    suggestedName: (x.suggested_name as string | null) ?? null,
    moments: x.n as number,
  }));
}

/** One person, for their page. */
export async function getSpeaker(id: number) {
  return (await listSpeakers()).find((s) => s.id === id) ?? null;
}

export async function speakerMoments(id: number, limit = 100): Promise<Moment[]> {
  const db = await getDb();
  const r = await db.execute(`${MOMENT_SELECT} WHERE m.speaker_id = ? ORDER BY m.at DESC LIMIT ?`, [
    id,
    limit,
  ]);
  return r.rows.map(toMoment);
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

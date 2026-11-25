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
import { OCR_FOUND, readPendingPhotoText, readTextOf } from './photo-ocr';
import {
  embedDocument,
  embedderChanged,
  embedQuery,
  ftsQuery,
  fuseRankings,
  imageHits,
  PHOTO_EMBED_BATCH,
  mentionedName,
  timeWindow,
} from './search-logic';
import {
  addEvidence,
  addresseeOf,
  findNameCues,
  fullNameFromContacts,
  ADDRESS_WINDOW_MS,
} from './names';
import {
  addToCentroid,
  canStartNewVoice,
  claimPending,
  cosine,
  matchShortClip,
  matchSpeaker,
  ownerCentroid,
  ownerClaimHolds,
  type PendingClip,
  RELIABLE_VOICE_MS,
  type Speaker,
} from './voices';
import { applyAutoName, assignLabel, collectPersonInfo, type KeptLine } from './people';
import { CONVERSATION_GAP_MS, speakerLabel } from './people-logic';
import { liveTranscript } from '@/engine/live-transcript';

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
  /** The line's saved audio (speech), while it is kept. */
  audioPath?: string | null;
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
  audioPath: (r.audio_path as string | null) ?? null,
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

/** Tells the native listener the owner's voice (barge-in is owner-only). Older builds: no-op. */
const pushOwnerVoice = (centroid: number[] | null) =>
  SidekickNative.listenSetOwnerVoice?.(centroid);

/** Sends the owner's current voice to the native listener (at start and after deletions). */
export async function syncOwnerVoice() {
  pushOwnerVoice(ownerCentroid(await speakers()));
}

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

/**
 * Finds (and learns) who is speaking. Owner clips teach the owner's voice. Also says whether the
 * line counts as the owner's: a wake-word clip that doesn't sound like the owner does not.
 */
async function assignSpeaker(
  voice: number[] | null,
  owner: boolean,
  durationMs?: number,
  /** Push-to-talk: certainly the owner. */
  trusted = false,
): Promise<{ speaker: Speaker | null; owner: boolean }> {
  if (!voice) return { speaker: null, owner };
  const db = await getDb();
  const all = await speakers();
  console.log(
    `[voice] ${owner ? 'owner clip' : 'clip'} sims: ${all.map((x) => `${x.id}${x.isOwner ? '*' : ''}=${cosine(voice, x.centroid).toFixed(2)}`).join(' ')}`,
  );
  const known = all.find((x) => x.isOwner) ?? null;
  if (!trusted && durationMs != null && durationMs < RELIABLE_VOICE_MS) {
    // Too short to trust: nothing is learned. A short wake-word line stays the owner's as before
    // (no voice); anyone else's only joins a clearly closest known voice.
    if (owner) return { speaker: null, owner: true };
    return { speaker: matchShortClip(voice, all), owner: false };
  }
  if (owner && !trusted && !ownerClaimHolds(voice, known)) owner = false;
  let s = owner ? known : matchSpeaker(voice, all);
  if (s) {
    const c = addToCentroid(s, voice);
    await db.execute('UPDATE speakers SET centroid = ?, count = count + 1 WHERE id = ?', [
      JSON.stringify(c),
      s.id,
    ]);
    if (s.isOwner) pushOwnerVoice(c);
    return { speaker: s, owner: s.isOwner };
  }
  if (!owner && !canStartNewVoice(durationMs)) {
    // Too short to start a person: join a clearly closest known voice, else wait for one.
    return { speaker: matchShortClip(voice, all), owner: false };
  }
  const r = await db.execute('INSERT INTO speakers (is_owner, centroid) VALUES (?, ?)', [
    owner ? 1 : 0,
    JSON.stringify(voice),
  ]);
  s = { id: r.insertId!, centroid: voice, count: 1, isOwner: owner };
  if (owner) pushOwnerVoice(voice);
  // Every new voice is "Person N" right away, stable for that voice.
  if (!owner) {
    await assignLabel(s.id);
    await claimWaitingClips(s, [...all, s]);
  }
  return { speaker: s, owner };
}

/** Short clips nobody matched yet (in memory only), re-checked when a new voice appears. */
let pendingClips: PendingClip[] = [];

/** Relabels earlier "Someone" lines that clearly belong to a voice that just became known. */
async function claimWaitingClips(joined: Speaker, all: Speaker[]) {
  const { claimed, waiting } = claimPending(pendingClips, joined, all, Date.now());
  pendingClips = waiting;
  if (!claimed.length) return;
  const db = await getDb();
  for (const c of claimed) {
    if (c.momentId != null)
      await db.execute('UPDATE moments SET speaker_id = ? WHERE id = ? AND speaker_id IS NULL', [
        joined.id,
        c.momentId,
      ]);
    liveTranscript.relabel(c.at, joined.id);
  }
  console.log(`[voice] ${claimed.length} earlier short line(s) now voice ${joined.id}`);
}

/** A push-to-talk clip is always the owner: use it to learn their voice. */
export async function learnOwnerVoice(voice: number[]) {
  await assignSpeaker(voice, true, undefined, true);
}

let lastConsentAsk = 0;

let ingesting: Promise<number> | null = null;

/**
 * Moves everything the listener heard into memory, applying consent rules. Runs one at a time
 * (the timer and each transcript event both call it); every line also goes to the live transcript.
 */
export async function ingestJournal(): Promise<number> {
  while (ingesting) await ingesting.catch(() => 0);
  ingesting = ingestJournalNow();
  try {
    return await ingesting;
  } finally {
    ingesting = null;
  }
}

async function ingestJournalNow(): Promise<number> {
  const lines = SidekickNative.journalDrain();
  if (!lines.length) return 0;
  const db = await getDb();
  const consentMode = consentModeNow();
  let added = 0;
  const kept: KeptLine[] = [];
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
    const { speaker: s, owner: isOwner } = await assignSpeaker(e.voice, e.owner, e.durationMs);
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
      if (!keepOtherSpeech({ consentMode, speakerConsented: consented })) {
        // Not kept: nor is their voice recording.
        if (e.audioPath) SidekickNative.deleteFile(e.audioPath);
        if (!s && e.voice) pendingClips.push({ at: e.at, voice: e.voice, momentId: null });
        liveTranscript.put({
          at: e.at,
          text: e.text,
          speakerId: s?.id ?? null,
          isOwner,
          saved: false,
        });
        continue;
      }
    }
    const ins = await db.execute(
      'INSERT INTO moments (kind, at, text, speaker_id, audio_path) VALUES (?, ?, ?, ?, ?)',
      [e.kind, e.at, e.text, s?.id ?? null, e.audioPath ?? null],
    );
    await tagPlace(ins.insertId!, entryPlace(e));
    if (!s && !isOwner && e.voice)
      pendingClips.push({ at: e.at, voice: e.voice, momentId: ins.insertId! });
    kept.push({ id: ins.insertId!, at: e.at, speakerId: s?.id ?? null, isOwner, text: e.text });
    liveTranscript.put({ at: e.at, text: e.text, speakerId: s?.id ?? null, isOwner, saved: true });
    added++;
  }
  try {
    await suggestNamesFrom(kept);
  } catch (err) {
    console.log(`[memory] name suggestions failed: ${String(err)}`);
  }
  try {
    await collectPersonInfo(kept);
  } catch (err) {
    console.log(`[memory] person notes failed: ${String(err)}`);
  }
  return added;
}

// --- Names ---

/**
 * Looks for "I'm Sam" / "thanks, Sam" in newly kept lines: a strong self-introduction names the
 * voice automatically (marked auto); anything else is recorded as a suggestion.
 */
async function suggestNamesFrom(lines: KeptLine[]) {
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
          cue.replyExpected,
        );
      }
      if (target == null) continue;
      const name = await expandName(cue.name);
      if (!(cue.strong && (await applyAutoName(target, name)))) await suggestName(target, name);
    }
  }
}

/** "Sam" → "Sam Jones" when contacts are on and exactly one contact is called Sam. */
async function expandName(name: string): Promise<string> {
  if (!getSettings().sourceContacts) return name;
  const db = await getDb();
  const r = await db.execute('SELECT name FROM contacts');
  return fullNameFromContacts(
    name,
    r.rows.map((x) => x.name as string),
  );
}

/**
 * Adds evidence that voice [speakerId] is called [name] ([weight] cues). Shown as "Is this Sam?";
 * once the evidence adds up (several cues, or context plus a cue), applied as an auto name the
 * user can undo. Never for the owner, a named voice, or a name the user said no to.
 */
export async function suggestName(speakerId: number, name: string, weight = 1) {
  const db = await getDb();
  const r = await db.execute(
    'SELECT name, is_owner, suggested_name, suggested_count, dismissed_names FROM speakers WHERE id = ?',
    [speakerId],
  );
  const row = r.rows[0];
  if (!row || row.name || row.is_owner === 1) return;
  if (
    String(row.dismissed_names ?? '')
      .split('|')
      .includes(name)
  )
    return;
  const next = addEvidence(
    { name: (row.suggested_name as string | null) ?? null, count: row.suggested_count as number },
    name,
    weight,
  );
  if (!next) return;
  if (next.apply && (await applyAutoName(speakerId, name))) return;
  await db.execute('UPDATE speakers SET suggested_name = ?, suggested_count = ? WHERE id = ?', [
    name,
    next.count,
    speakerId,
  ]);
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

// --- Names from context ---

export type NameConversation = {
  /** The newest line read (a later read only runs once there is a newer one). */
  lastId: number;
  /** The conversation's first line: one model reading per voice per conversation counts. */
  startId: number;
  lines: { who: string; text: string }[];
  /** "Person 3" → speaker id, for unnamed voices only. */
  labels: Map<string, number>;
};

/**
 * The conversation going on now (or the latest one): its last [limit] heard lines, back to a
 * 10-minute gap. Null if nothing new since [afterId] or no unnamed voice in it.
 */
export async function currentConversationForNames(
  limit: number,
  afterId: number,
): Promise<NameConversation | null> {
  const db = await getDb();
  const r = await db.execute(
    `SELECT m.id, m.at, m.text, m.speaker_id, s.name, s.is_owner, s.label_no FROM moments m
     LEFT JOIN speakers s ON s.id = m.speaker_id
     WHERE m.kind = 'speech' AND length(m.text) > 0 ORDER BY m.at DESC LIMIT ?`,
    [limit],
  );
  const rows = r.rows;
  if (!rows.length || (rows[0].id as number) <= afterId) return null;
  let cut = rows.length;
  for (let k = 1; k < rows.length; k++) {
    if ((rows[k - 1].at as number) - (rows[k].at as number) > CONVERSATION_GAP_MS) {
      cut = k;
      break;
    }
  }
  const convo = rows.slice(0, cut).reverse();
  const lines: { who: string; text: string }[] = [];
  const labels = new Map<string, number>();
  for (const x of convo) {
    const id = x.speaker_id as number | null;
    let who: string;
    if (id == null) who = 'Someone';
    else if (x.is_owner === 1) who = 'Me';
    else if (x.name) who = x.name as string;
    else {
      who = `Person ${(x.label_no as number | null) ?? id}`;
      labels.set(who, id);
    }
    lines.push({ who, text: (x.text as string).slice(0, 300) });
  }
  if (!labels.size) return null;
  return { lastId: rows[0].id as number, startId: convo[0].id as number, lines, labels };
}

/** What an unnamed voice seems to be ("Waiter"); the latest reading, with more context, wins. */
export async function setSpeakerDescription(speakerId: number, description: string) {
  const db = await getDb();
  await db.execute(
    'UPDATE speakers SET description = ? WHERE id = ? AND name IS NULL AND is_owner = 0',
    [description, speakerId],
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
  // The photo's text (OCR, ~1 s): searchable right away. Not awaited, so saving isn't held up.
  (id) => {
    void readTextOf(id).catch(() => {});
    return Promise.resolve();
  },
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
    `SELECT s.id, s.name, s.is_owner, s.label_no, s.description FROM moment_people p JOIN speakers s ON s.id = p.speaker_id
     WHERE p.moment_id = ? ORDER BY s.is_owner DESC, s.id`,
    [momentId],
  );
  return r.rows.map((x) =>
    speakerLabel({
      id: x.id as number,
      name: (x.name as string | null) ?? null,
      isOwner: x.is_owner === 1,
      labelNo: (x.label_no as number | null) ?? null,
      description: (x.description as string | null) ?? null,
    }),
  );
}

/** The newest saved photo not yet described (photos whose text OCR found are left to OCR). */
export async function nextUndescribedPhoto(): Promise<{ id: number; photoPath: string } | null> {
  const db = await getDb();
  const r = await db.execute(
    `SELECT m.id, m.photo_path FROM moments m
     LEFT JOIN photo_descriptions d ON d.moment_id = m.id
     WHERE m.photo_path IS NOT NULL AND m.kind != 'frame' AND d.moment_id IS NULL AND m.photo_ocr != ${OCR_FOUND}
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

/** A new embedder file may place text slightly differently: re-embed every memory once. */
async function reembedIfModelChanged() {
  const db = await getDb();
  const r = await db.execute("SELECT value FROM meta WHERE key = 'embedder'");
  if (!embedderChanged((r.rows[0]?.value as string | undefined) ?? null, EMBEDDER_FILE.name))
    return;
  // Old vectors stay searchable until each is replaced.
  await db.execute('UPDATE moments SET embedded = 0');
  await db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('embedder', ?)", [
    EMBEDDER_FILE.name,
  ]);
}

/** Gives saved photos a vector of the image itself, so they're found by what they show. */
async function embedPendingPhotos(limit = PHOTO_EMBED_BATCH): Promise<number> {
  const db = await getDb();
  const r = await db.execute(
    'SELECT id, photo_path FROM moments WHERE photo_path IS NOT NULL AND image_embedded = 0 ORDER BY id DESC LIMIT ?',
    [limit],
  );
  for (const row of r.rows) {
    const id = row.id as number;
    const path = row.photo_path as string;
    try {
      if (SidekickNative.fileExists(path)) {
        const t0 = Date.now();
        const [v] = await SidekickNative.embedImages(modelPath(EMBEDDER_FILE), [path], EMBED_DIMS);
        // vec0 tables ignore OR REPLACE: delete first so re-embedding works.
        await db.execute('DELETE FROM photos_vec WHERE id = ?', [id]);
        await db.execute('INSERT INTO photos_vec (id, embedding) VALUES (?, ?)', [id, vecParam(v)]);
        console.log(`[embed] photo ${id}, ${Date.now() - t0} ms`);
      }
    } catch (e) {
      // A photo that can't be read is skipped rather than retried forever.
      console.log(`[embed] photo ${id} failed: ${String(e)}`);
    }
    await db.execute('UPDATE moments SET image_embedded = 1 WHERE id = ?', [id]);
  }
  return r.rows.length;
}

/** Embeds moments (text, and photos) that don't have a vector yet. Call when otherwise idle. */
export async function embedPending(limit = 64): Promise<number> {
  await readPendingPhotoText().catch(() => 0);
  if (!isDownloaded(EMBEDDER_FILE)) return 0;
  await reembedIfModelChanged();
  const photos = await embedPendingPhotos();
  const db = await getDb();
  const r = await db.execute(
    "SELECT id, text, place FROM moments WHERE embedded = 0 AND text != '' ORDER BY id LIMIT ?",
    [limit],
  );
  if (!r.rows.length) return photos;
  const t0 = Date.now();
  const vecs = await SidekickNative.embed(
    modelPath(EMBEDDER_FILE),
    r.rows.map((x) =>
      embedDocument(x.place ? `${x.text as string} (in ${x.place as string})` : (x.text as string)),
    ),
    EMBED_DIMS,
  );
  await db.transaction(async (tx) => {
    for (let i = 0; i < r.rows.length; i++) {
      // vec0 tables ignore OR REPLACE (re-embedding after OCR failed): delete first.
      await tx.execute('DELETE FROM moments_vec WHERE id = ?', [r.rows[i].id as number]);
      await tx.execute('INSERT INTO moments_vec (id, embedding) VALUES (?, ?)', [
        r.rows[i].id as number,
        vecParam(vecs[i]),
      ]);
      await tx.execute('UPDATE moments SET embedded = 1 WHERE id = ?', [r.rows[i].id as number]);
    }
  });
  console.log(`[embed] ${r.rows.length} items, ${Date.now() - t0} ms`);
  return photos + r.rows.length;
}

/** How many memories still need a vector (0 if the embedder isn't downloaded). */
export async function countPendingEmbeds(): Promise<number> {
  if (!isDownloaded(EMBEDDER_FILE)) return 0;
  await reembedIfModelChanged();
  const db = await getDb();
  const r = await db.execute(
    "SELECT COUNT(*) AS n FROM moments WHERE (embedded = 0 AND text != '') OR (photo_path IS NOT NULL AND image_embedded = 0)",
  );
  return (r.rows[0]?.n as number | undefined) ?? 0;
}

const MOMENT_SELECT =
  // Unnamed voices show as their automatic label ("Person 3") in lists and prompts.
  "SELECT m.*, COALESCE(s.name, s.description, 'Person ' || s.label_no) AS name, s.is_owner FROM moments m LEFT JOIN speakers s ON s.id = m.speaker_id";

/** Hybrid search: meaning (vectors) + exact words (FTS5), narrowed by time words in the question. */
export async function searchMemory(question: string, k = 8, now = new Date()): Promise<Moment[]> {
  const db = await getDb();
  const win = timeWindow(question, now);
  const lists: number[][] = [];
  if (isDownloaded(EMBEDDER_FILE)) {
    try {
      // The embedder is loaded for the question anyway: first catch up on memories still waiting
      // for an idle-time batch, so every memory is searchable by meaning, not only by words.
      // Capped: at ~0.34 s per memory on a Pixel 5, 16 adds at most ~5 s; idle time does the rest.
      await embedPending(16);
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
      // The same question vector against the photos themselves (one shared space).
      const p = await db.execute(
        'SELECT id FROM photos_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance',
        [vecParam(qv), imageHits(!!win)],
      );
      lists.push(p.rows.map((x) => x.id as number));
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
  console.log(`[memory] search lists (text vec, photo vec, words): ${lists.map((l) => l.length)}`);
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
  ids = await narrowByPlaceOrPerson(question, ids);
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

/**
 * "What did Sam say", "what did I see in Leeds": keep only moments with that named person (as the
 * speaker or around a photo) or at that place. Falls back to their most recent moments when no
 * ranked result matches, and to the unfiltered results when the name has no moments at all.
 */
async function narrowByPlaceOrPerson(question: string, ids: number[]): Promise<number[]> {
  const db = await getDb();
  const places = (
    await db.execute('SELECT DISTINCT place FROM moments WHERE place IS NOT NULL')
  ).rows.map((x) => x.place as string);
  const people = (await db.execute('SELECT id, name FROM speakers WHERE name IS NOT NULL')).rows;
  let wanted: Set<number> | null = null;
  const place = mentionedName(question, places);
  if (place) {
    const r = await db.execute(
      'SELECT id FROM moments WHERE place = ? ORDER BY at DESC LIMIT 500',
      [place],
    );
    wanted = new Set(r.rows.map((x) => x.id as number));
  }
  const person = mentionedName(
    question,
    people.map((x) => x.name as string),
  );
  if (person) {
    const pid = people.filter((x) => x.name === person).map((x) => x.id as number);
    const marks = pid.map(() => '?').join(',');
    const r = await db.execute(
      `SELECT id FROM moments WHERE speaker_id IN (${marks})
       UNION SELECT moment_id FROM moment_people WHERE speaker_id IN (${marks})
       UNION SELECT rowid FROM moments_fts WHERE moments_fts MATCH ?
       ORDER BY 1 DESC LIMIT 500`,
      [...pid, ...pid, `"${person.replace(/"/g, '')}"`],
    );
    const byPerson = new Set(r.rows.map((x) => x.id as number));
    wanted = wanted ? new Set([...wanted].filter((id) => byPerson.has(id))) : byPerson;
  }
  if (!wanted || !wanted.size) return ids;
  const kept = ids.filter((id) => wanted.has(id));
  return kept.length ? kept : [...wanted];
}

export async function recentMoments(limit = 100, offset = 0): Promise<Moment[]> {
  const db = await getDb();
  const r = await db.execute(`${MOMENT_SELECT} ORDER BY m.at DESC LIMIT ? OFFSET ?`, [
    limit,
    offset,
  ]);
  return r.rows.map(toMoment);
}

/** What was said and asked between [from] and [to], oldest first ("what did we talk about today"). */
export async function momentsBetween(from: number, to: number, limit = 400): Promise<Moment[]> {
  const db = await getDb();
  const r = await db.execute(
    `${MOMENT_SELECT} WHERE m.at >= ? AND m.at < ? AND m.kind IN ('speech', 'answer', 'question')
     AND length(m.text) > 0 ORDER BY m.at DESC LIMIT ?`,
    [from, to, limit],
  );
  return r.rows.map(toMoment).reverse();
}

export async function savedFacts(): Promise<{ id: number; text: string; status: string }[]> {
  const db = await getDb();
  // The owner's facts only; facts about other people are on their pages (people.ts).
  const r = await db.execute(
    'SELECT id, text, status FROM facts WHERE speaker_id IS NULL ORDER BY at DESC',
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    text: x.text as string,
    status: x.status as string,
  }));
}

export async function listSpeakers() {
  const db = await getDb();
  const r = await db.execute(
    'SELECT s.id, s.name, s.is_owner, s.consented_at, s.suggested_name, s.label_no, s.description, s.name_auto, s.notes, COUNT(m.id) AS n FROM speakers s LEFT JOIN moments m ON m.speaker_id = s.id GROUP BY s.id ORDER BY n DESC',
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    name: (x.name as string | null) ?? null,
    isOwner: x.is_owner === 1,
    consented: x.consented_at != null,
    suggestedName: (x.suggested_name as string | null) ?? null,
    labelNo: (x.label_no as number | null) ?? null,
    description: (x.description as string | null) ?? null,
    /** Named automatically from "my name is …" (not yet confirmed by the user). */
    nameAuto: x.name_auto === 1,
    notes: (x.notes as string | null) ?? '',
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
  // The user's own name for the voice: no longer auto, and any pending guess is dropped.
  await db.execute(
    'UPDATE speakers SET name = ?, name_auto = 0, suggested_name = NULL, suggested_count = 0 WHERE id = ?',
    [name.trim() || null, id],
  );
}

// --- Deleting ---

/** The photo and audio files of the moments being deleted go with them. */
async function deletePhotos(where: string, params: (number | string)[]) {
  const db = await getDb();
  const r = await db.execute(
    `SELECT photo_path, audio_path FROM moments WHERE (photo_path IS NOT NULL OR audio_path IS NOT NULL) AND ${where}`,
    params,
  );
  for (const x of r.rows) {
    if (x.photo_path) SidekickNative.deleteFile(x.photo_path as string);
    if (x.audio_path) SidekickNative.deleteFile(x.audio_path as string);
  }
}

async function deleteMoments(where: string, params: (number | string)[]) {
  const db = await getDb();
  await deletePhotos(where, params);
  for (const table of ['moments_vec', 'photos_vec']) {
    await db.execute(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM moments WHERE ${where})`,
      params,
    );
  }
  await db.execute(`DELETE FROM moments WHERE ${where}`, params);
}

export const deleteMoment = (id: number) => deleteMoments('id = ?', [id]);
export const deleteRange = (from: number, to: number) =>
  deleteMoments('at >= ? AND at < ?', [from, to]);
/** Everything one data source added (e.g. kind 'file'). */
export const deleteKind = (kind: string) => deleteMoments('kind = ?', [kind]);

export async function deleteSpeaker(id: number) {
  await deleteMoments('speaker_id = ?', [id]);
  const db = await getDb();
  await db.execute('DELETE FROM speakers WHERE id = ?', [id]);
  await syncOwnerVoice();
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
  pushOwnerVoice(null);
  await db.execute('DELETE FROM facts');
  await db.execute('DELETE FROM followups');
  await db.execute('DELETE FROM contacts');
  liveTranscript.clear();
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
  const people = (
    await db.execute(
      'SELECT id, name, is_owner, consented_at, label_no, description, notes FROM speakers',
    )
  ).rows;
  const facts = (await db.execute('SELECT id, text, status, at, speaker_id FROM facts')).rows;
  const followups = (
    await db.execute(
      'SELECT id, kind, title, due_at, all_day, when_text, status, created_at, person_id FROM followups',
    )
  ).rows;
  const json = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      moments: moments.map((m) => ({
        ...m,
        photo_path: m.photo_path ? `photos/${String(m.photo_path).split('/').pop()}` : null,
      })),
      people,
      facts,
      followups,
    },
    null,
    2,
  );
  const photos = moments.map((m) => m.photo_path as string | null).filter((p): p is string => !!p);
  const dest = `${SidekickNative.getDeviceInfo().filesDir}/exports/sidekick-export-${Date.now()}.zip`;
  return SidekickNative.exportZip(json, photos, dest);
}

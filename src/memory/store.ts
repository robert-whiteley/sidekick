import { reclaimSpace, scheduleReclaim } from './reclaim';
import { oneRunAtATime } from './one-run';
import { isStaleSuggestion, isTemplate } from './fact-extraction';
import SidekickNative, { type JournalEntry } from '../../modules/sidekick-native';
import { isDownloaded, modelPath } from '@/engine/downloads';
import { EMBEDDER_FILE } from '@/engine/models';
import { dataDir } from '@/engine/paths';
import { here, placeName } from '@/engine/places';
import { consentModeNow } from '@/engine/region';
import { getSettings } from '@/engine/settings';
import { guardWrite, mayGrowMemory } from '@/engine/storage-guard';
import { isAgreement, isConsentQuestion, CONSENT_WINDOW_MS, lineFate } from './consent';
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
  type NameCue,
  replySettled,
  type Utterance,
} from './names';
import {
  addToCentroid,
  chooseSpeaker,
  claimPending,
  cosine,
  ownerCentroid,
  PENDING_CLIP_MS,
  type PendingClip,
  voiceFromPending,
  type Speaker,
} from './voices';
import { applyAutoName, assignLabel, collectPersonInfo, type KeptLine } from './people';
import { CONVERSATION_GAP_MS, nextLabelNo, type PersonRef, speakerLabel } from './people-logic';
import { isUnsavedId, UnsavedVoices } from './unsaved-voices';
import { liveTranscript } from '@/engine/live-transcript';
import { noteFix } from '@/engine/location-track';
import { momentIdsAtNamedPlace } from './places-store';
import { AckPolicy, takeJournal } from './journal-take';

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

/** When the owner last asked for consent ("is it OK if I take notes?"). */
let lastConsentAsk = 0;

/** A voice to match against: stored (with whether it agreed to notes) or unsaved (in memory). */
type Known = Speaker & { consented: boolean };

/** When each stored voice was last heard in this app session (conversation context). */
const lastHeard = new Map<number, number>();

/** Voices that haven't agreed (consent mode): told apart for the conversation, never stored. */
const unsaved = new UnsavedVoices();

/** Stored voices only (the owner's voice, people pages). */
async function speakers(): Promise<Known[]> {
  const db = await getDb();
  const r = await db.execute('SELECT id, centroid, count, is_owner, consented_at FROM speakers');
  const out: Known[] = [];
  for (const x of r.rows) {
    const centroid = JSON.parse(x.centroid as string) as number[];
    if (!centroid.length) continue; // voiceprint removed (forgetUnagreedVoices)
    const id = x.id as number;
    out.push({
      id,
      centroid,
      count: x.count as number,
      isOwner: x.is_owner === 1,
      consented: x.consented_at != null,
      lastAt: lastHeard.get(id),
    });
  }
  return out;
}

/** Stored voices and the unsaved ones of the conversation going on. */
async function voicesNow(now: number): Promise<Known[]> {
  return [...(await speakers()), ...unsaved.all(now).map((v) => ({ ...v, consented: false }))];
}

/** Unsaved voices for the live transcript (labels only; nothing stored). */
export function unsavedPeople(now = Date.now()): PersonRef[] {
  return unsaved.people(now);
}

/** The label number a new voice gets: past every stored and on-screen one. */
async function newLabelNo(now: number): Promise<number> {
  const db = await getDb();
  const r = await db.execute('SELECT label_no FROM speakers WHERE is_owner = 0');
  return nextLabelNo([
    ...r.rows.map((x) => (x.label_no as number | null) ?? null),
    ...unsaved.labels(now),
  ]);
}

/** Stores a new voice; [labelNo] keeps the label it had on screen while unsaved. */
async function storeVoice(
  centroid: number[],
  count: number,
  isOwner: boolean,
  consentedAt: number | null,
  labelNo?: number,
): Promise<Known> {
  const db = await getDb();
  const r = await db.execute(
    'INSERT INTO speakers (is_owner, centroid, count, consented_at) VALUES (?, ?, ?, ?)',
    [isOwner ? 1 : 0, JSON.stringify(centroid), count, consentedAt],
  );
  const id = r.insertId!;
  if (isOwner) pushOwnerVoice(centroid);
  else {
    if (labelNo != null)
      await db.execute(
        'UPDATE speakers SET label_no = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM speakers WHERE label_no = ? AND is_owner = 0)',
        [labelNo, id, labelNo],
      );
    // Every new voice is "Person N" right away, stable for that voice.
    await assignLabel(id);
  }
  return { id, centroid, count, isOwner, consented: consentedAt != null };
}

/**
 * Who said a line, and whether it is kept. A voice is written to the database only with a line of
 * theirs that is kept: in consent mode, voices that haven't agreed stay in memory (unsaved) for
 * the conversation, so lines are still told apart on screen, and their voiceprint is never stored.
 * Owner clips teach the owner's voice; a wake-word clip that doesn't sound like the owner doesn't
 * count as theirs. [trusted]: push-to-talk, certainly the owner.
 */
async function hearVoice(
  voice: number[] | null,
  claimsOwner: boolean,
  durationMs: number | undefined,
  at: number,
  opts: { trusted?: boolean; consentMode: boolean; text?: string },
): Promise<{ speaker: Known | null; owner: boolean; kept: boolean }> {
  const fate = (isOwner: boolean, s: { consented: boolean } | null) =>
    lineFate({
      consentMode: opts.consentMode,
      isOwner,
      hasVoice: !!s,
      consented: s?.consented ?? false,
      agrees: !!opts.text && at - lastConsentAsk < CONSENT_WINDOW_MS && isAgreement(opts.text),
    });
  if (!voice) {
    const f = fate(claimsOwner, null);
    return { speaker: null, owner: claimsOwner, kept: f.keep };
  }
  const db = await getDb();
  const all = await voicesNow(at);
  console.log(
    // The closest few only: one entry per voice ever heard made this line grow without end.
    `[voice] ${claimsOwner ? 'owner clip' : 'clip'} sims (of ${all.length}): ${all
      .map((x) => ({ x, sim: cosine(voice, x.centroid) }))
      .sort((p, q) => q.sim - p.sim)
      .slice(0, 5)
      .map(({ x, sim }) => `${x.id}${x.isOwner ? '*' : ''}=${sim.toFixed(2)}`)
      .join(' ')}`,
  );
  const choice = chooseSpeaker(voice, claimsOwner, durationMs, !!opts.trusted, all, undefined, at);

  if (choice.kind === 'none') {
    if (choice.owner) return { speaker: null, owner: true, kept: true };
    // Short unmatched clips that sound alike may add up to a new person.
    const found = voiceFromPending(voice, durationMs, pendingClips, all, at);
    if (!found) return { speaker: null, owner: false, kept: fate(false, null).keep };
    const f = fate(false, { consented: false });
    const count = found.group.length + 1;
    const s: Known = f.keep
      ? await storeVoice(found.centroid, count, false, f.consentNow ? at : null)
      : { ...unsaved.add(found.centroid, count, await newLabelNo(at), at), consented: false };
    if (s.id > 0) lastHeard.set(s.id, at);
    pendingClips = pendingClips.filter((p) => !found.group.includes(p));
    await giveClips(found.group, s);
    console.log(`[voice] ${count} short lines together are a new voice ${s.id}`);
    await claimWaitingClips(s, [...all, s]);
    return { speaker: s, owner: false, kept: f.keep };
  }

  if (choice.kind === 'join') {
    const s = choice.speaker as Known;
    const f = fate(s.isOwner, s);
    if (isUnsavedId(s.id)) {
      if (!f.keep) {
        unsaved.heard(s.id, at, choice.learn ? voice : undefined);
        return { speaker: s, owner: false, kept: false };
      }
      // It agreed (or consent mode went off): stored from now on, under the label it had.
      const u = unsaved.take(s.id)!;
      const c = choice.learn ? addToCentroid(u, voice) : u.centroid;
      const saved = await storeVoice(
        c,
        u.count + (choice.learn ? 1 : 0),
        false,
        f.consentNow ? at : null,
        u.labelNo,
      );
      lastHeard.set(saved.id, at);
      liveTranscript.respeak(u.id, saved.id);
      return { speaker: saved, owner: false, kept: true };
    }
    lastHeard.set(s.id, at);
    if (f.consentNow) {
      await db.execute('UPDATE speakers SET consented_at = ? WHERE id = ?', [at, s.id]);
      s.consented = true;
    }
    // Nothing of a line that isn't kept is learned into a stored voiceprint.
    if (choice.learn && f.keep) {
      const c = addToCentroid(s, voice);
      await db.execute('UPDATE speakers SET centroid = ?, count = count + 1 WHERE id = ?', [
        JSON.stringify(c),
        s.id,
      ]);
      if (s.isOwner) pushOwnerVoice(c);
    }
    return { speaker: s, owner: s.isOwner, kept: f.keep };
  }

  const f = fate(choice.owner, { consented: false });
  const s: Known = f.keep
    ? await storeVoice(voice, 1, choice.owner, f.consentNow ? at : null)
    : { ...unsaved.add(voice, 1, await newLabelNo(at), at), consented: false };
  if (s.id > 0) lastHeard.set(s.id, at);
  if (!choice.owner) await claimWaitingClips(s, [...all, s]);
  return { speaker: s, owner: choice.owner, kept: f.keep };
}

/** Short clips nobody matched yet (in memory only), re-checked when a new voice appears. */
let pendingClips: PendingClip[] = [];

/** Waits for a voice to claim it; ones past PENDING_CLIP_MS are dropped (only ever used within it). */
function addPendingClip(c: PendingClip) {
  pendingClips = pendingClips.filter((p) => c.at - p.at <= PENDING_CLIP_MS);
  pendingClips.push(c);
}

/** Earlier "Someone" lines become [s]'s: on screen, and in memory when both are stored. */
async function giveClips(clips: PendingClip[], s: Speaker) {
  const db = await getDb();
  for (const c of clips) {
    if (c.momentId != null && !isUnsavedId(s.id))
      await db.execute('UPDATE moments SET speaker_id = ? WHERE id = ? AND speaker_id IS NULL', [
        s.id,
        c.momentId,
      ]);
    liveTranscript.relabel(c.at, s.id);
  }
}

/** Relabels earlier "Someone" lines that clearly belong to a voice that just became known. */
async function claimWaitingClips(joined: Speaker, all: Speaker[]) {
  const { claimed, waiting } = claimPending(pendingClips, joined, all, Date.now());
  pendingClips = waiting;
  if (!claimed.length) return;
  await giveClips(claimed, joined);
  console.log(`[voice] ${claimed.length} earlier short line(s) now voice ${joined.id}`);
}

/**
 * Consent mode: voiceprints of people who never agreed and have no kept line are removed (older
 * builds stored one for every voice heard). A person the user named or wrote notes about keeps
 * their page, without the voiceprint; the rest are deleted. Returns how many were cleaned.
 */
export async function forgetUnagreedVoices(): Promise<number> {
  if (!consentModeNow()) return 0;
  const db = await getDb();
  const orphan =
    "is_owner = 0 AND consented_at IS NULL AND centroid <> '[]' AND NOT EXISTS (SELECT 1 FROM moments m WHERE m.speaker_id = speakers.id)";
  const kept = "(name IS NOT NULL OR notes <> '')";
  const del = await db.execute(`DELETE FROM speakers WHERE ${orphan} AND NOT ${kept}`);
  const wiped = await db.execute(
    `UPDATE speakers SET centroid = '[]', count = 0 WHERE ${orphan} AND ${kept}`,
  );
  const n = (del.rowsAffected ?? 0) + (wiped.rowsAffected ?? 0);
  if (n) console.log(`[voice] removed ${n} stored voice(s) that never agreed to notes`);
  return n;
}

/** A push-to-talk clip is always the owner: use it to learn their voice. */
export async function learnOwnerVoice(voice: number[]) {
  await hearVoice(voice, true, undefined, Date.now(), { trusted: true, consentMode: false });
}

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

const journalAcks = new AckPolicy();

async function ingestJournalNow(): Promise<number> {
  // Phone storage full: the lines stay in the journal (on the phone) until there is space.
  if (!mayGrowMemory()) return 0;
  const batch = takeJournal(SidekickNative);
  const lines = batch.lines;
  if (!lines.length) return 0;
  const db = await getDb();
  const consentMode = consentModeNow();
  let added = 0;
  let failed = false;
  const kept: KeptLine[] = [];
  for (const line of lines) {
    let e: JournalEntry;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      if (batch.replayed > 0 && e.kind !== 'location') {
        // Handed out before (the app was killed or a write failed while saving): skip saved ones.
        const seen = await db.execute('SELECT 1 FROM moments WHERE kind = ? AND at = ? LIMIT 1', [
          e.kind,
          e.at,
        ]);
        if (seen.rows.length) continue;
      }
      if (e.kind === 'location') {
        // The location track (while listening); not a moment.
        await noteFix(e).catch(() => false);
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
      const heard = await hearVoice(e.voice, e.owner, e.durationMs, e.at, {
        consentMode,
        text: e.text,
      });
      const s = heard.speaker;
      const isOwner = heard.owner;
      if (isOwner && isConsentQuestion(e.text)) lastConsentAsk = e.at;
      if (!heard.kept) {
        // Not kept: nor is their voice recording, nor their voiceprint (memory only).
        if (e.audioPath) SidekickNative.deleteFile(e.audioPath);
        if (!s && e.voice)
          addPendingClip({ at: e.at, voice: e.voice, momentId: null, durationMs: e.durationMs });
        liveTranscript.put({
          at: e.at,
          text: e.text,
          speakerId: s?.id ?? null,
          isOwner,
          saved: false,
        });
        continue;
      }
      const ins = await db.execute(
        'INSERT INTO moments (kind, at, text, speaker_id, audio_path) VALUES (?, ?, ?, ?, ?)',
        [e.kind, e.at, e.text, s?.id ?? null, e.audioPath ?? null],
      );
      await tagPlace(ins.insertId!, entryPlace(e));
      if (!s && !isOwner && e.voice)
        addPendingClip({
          at: e.at,
          voice: e.voice,
          momentId: ins.insertId!,
          durationMs: e.durationMs,
        });
      kept.push({ id: ins.insertId!, at: e.at, speakerId: s?.id ?? null, isOwner, text: e.text });
      liveTranscript.put({
        at: e.at,
        text: e.text,
        speakerId: s?.id ?? null,
        isOwner,
        saved: true,
      });
      added++;
    } catch (err) {
      // Kept on the phone and tried again at the next drain (a full disk, a locked database).
      failed = true;
      console.log(`[memory] journal line not saved: ${String(err)}`);
    }
  }
  if (journalAcks.done(failed)) batch.ack();
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

/** "Sam, can you…" cues waiting for Sam's answer (in memory only; see replySettled). */
let waitingCues: { line: KeptLine; cue: NameCue }[] = [];

/** Voiced lines within the addressing window around [at]. */
async function utterancesNear(at: number): Promise<Utterance[]> {
  const db = await getDb();
  const r = await db.execute(
    'SELECT m.at, m.speaker_id, s.is_owner FROM moments m JOIN speakers s ON s.id = m.speaker_id WHERE m.at BETWEEN ? AND ?',
    [at - ADDRESS_WINDOW_MS, at + ADDRESS_WINDOW_MS],
  );
  return r.rows.map((x) => ({
    at: x.at as number,
    speakerId: x.speaker_id as number,
    isOwner: x.is_owner === 1,
  }));
}

async function nameAddressee(line: KeptLine, cue: NameCue, nearby: Utterance[]) {
  const target = addresseeOf(line, nearby, cue.replyExpected);
  if (target != null) await suggestName(target, await expandName(cue.name));
}

/**
 * Looks for "I'm Sam" / "thanks, Sam" in newly kept lines: a strong self-introduction names the
 * voice automatically (marked auto); anything else is recorded as a suggestion. "Sam, can you…"
 * waits for the voice that answers (lines arrive one at a time, before the answer is heard).
 */
async function suggestNamesFrom(lines: KeptLine[]) {
  for (const line of lines) {
    for (const cue of findNameCues(line.text)) {
      if (cue.who === 'speaker') {
        const target = line.isOwner ? null : line.speakerId;
        if (target == null) continue;
        const name = await expandName(cue.name);
        if (!(cue.strong && (await applyAutoName(target, name)))) await suggestName(target, name);
      } else if (cue.replyExpected) waitingCues.push({ line, cue });
      else await nameAddressee(line, cue, await utterancesNear(line.at));
    }
  }
  if (!waitingCues.length) return;
  // The newest line heard; a cue whose answer never comes is settled a minute later at most.
  const newest = Math.max(Date.now() - 60_000, ...lines.map((l) => l.at));
  const still: typeof waitingCues = [];
  for (const w of waitingCues) {
    const nearby = await utterancesNear(w.line.at);
    if (replySettled(w.line, nearby, newest)) await nameAddressee(w.line, w.cue, nearby);
    else still.push(w);
  }
  waitingCues = still;
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
    if (isTemplate(t)) continue;
    if (!known.has(t.toLowerCase().replace(/\.$/, ''))) await saveFact(t, 'suggested');
  }
}

/** Saves a photo question: the original image is kept so detail questions can re-read it. */
export async function rememberPhotoQuestion(tmpPhoto: string, question: string, answer: string) {
  // Phone storage full: not remembered (the answer was still given).
  if (!mayGrowMemory()) return;
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
  // Throws StorageFullError (shown to the user) when the phone is out of space.
  guardWrite('photo');
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

/** The newest stored camera keyframe without a caption yet (see engine/describe-photos.ts). */
export async function nextUncaptionedFrame(): Promise<{ id: number; photoPath: string } | null> {
  const db = await getDb();
  const r = await db.execute(
    `SELECT m.id, m.photo_path FROM moments m
     LEFT JOIN photo_descriptions d ON d.moment_id = m.id
     WHERE m.kind = 'frame' AND m.photo_path IS NOT NULL AND d.moment_id IS NULL
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
async function embedPendingPhotos(
  limit = PHOTO_EMBED_BATCH,
  isBusy: () => boolean = () => false,
): Promise<number> {
  const db = await getDb();
  const r = await db.execute(
    'SELECT id, photo_path FROM moments WHERE photo_path IS NOT NULL AND image_embedded = 0 ORDER BY id DESC LIMIT ?',
    [limit],
  );
  let done = 0;
  for (const row of r.rows) {
    // One photo per native call, so a question waiting for the embedder gets it within one photo.
    if (isBusy()) break;
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
    done++;
  }
  return done;
}

/**
 * Embeds moments that don't have a vector yet: text always; photos (slow: the vision encoder) and
 * photo text reading only when [opts.photos] (idle time, never while a question waits). Photo
 * work stops as soon as [opts.isBusy] says a question started.
 */
export async function embedPending(
  limit = 64,
  opts: { photos?: boolean; isBusy?: () => boolean } = {},
): Promise<number> {
  // One run at a time: overlapping runs picked the same rows and embedded each photo 2-3 times,
  // queueing on the embedder (slow questions, battery drain). Idle-time callers skip when a run
  // is going; a question's text-only catch-up waits for it (photo runs yield to questions).
  // Phone storage full: vectors wait (search still works on what is stored).
  if (!mayGrowMemory()) return 0;
  return (await embedOnce(opts.photos !== false, limit, opts)) ?? 0;
}

const embedOnce = oneRunAtATime(
  (limit: number, opts: { photos?: boolean; isBusy?: () => boolean }) =>
    embedPendingNow(limit, opts),
);

async function embedPendingNow(
  limit: number,
  opts: { photos?: boolean; isBusy?: () => boolean },
): Promise<number> {
  const photosToo = opts.photos ?? true;
  if (photosToo) await readPendingPhotoText().catch(() => 0);
  if (!isDownloaded(EMBEDDER_FILE)) return 0;
  await reembedIfModelChanged();
  const photos = photosToo ? await embedPendingPhotos(PHOTO_EMBED_BATCH, opts.isBusy) : 0;
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
      // Text only: a photo vector takes 10-80 s, so photos are left to idle time.
      await embedPending(16, { photos: false });
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
  // A place the user named ("the gym"): moments recorded inside it.
  const atNamed = await momentIdsAtNamedPlace(question).catch(() => null);
  if (atNamed?.length) wanted = new Set(atNamed);
  const place = atNamed?.length ? null : mentionedName(question, places);
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
  // Suggestions saved by older versions that today's checks reject ("My name is [Name].",
  // "Please provide the conversation…") are dropped, not shown.
  const stale = r.rows.filter(
    (x) => x.status === 'suggested' && isStaleSuggestion(x.text as string),
  );
  for (const x of stale) await db.execute('DELETE FROM facts WHERE id = ?', [x.id as number]);
  return r.rows
    .filter((x) => !stale.includes(x))
    .map((x) => ({
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
  scheduleReclaim();
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
  unsaved.clear();
  lastHeard.clear();
  pushOwnerVoice(null);
  await db.execute('DELETE FROM facts');
  await db.execute('DELETE FROM followups');
  await db.execute('DELETE FROM contacts');
  liveTranscript.clear();
  await reclaimSpace({ force: true });
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

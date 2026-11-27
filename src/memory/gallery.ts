/**
 * Phone search, photos: an index of the photos the user allowed (iPhone: the Photos library, all
 * or only selected photos; Android: photo folders they picked; and image files in picked
 * folders). Nothing is read until the user turns it on; turning it off or removing a folder
 * deletes its part of the index. Only the index is stored (date, place, the text read from the
 * photo, a photo vector); the photo stays where it is and is re-read when found. Deleted photos
 * leave the index at the next listing.
 *
 * Reading runs on the phone, newest photos first, only while charging, cool and idle
 * (embed-policy.ts), a few photos per idle tick, and stops as soon as a question starts.
 */
import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { batteryState, chargerFallingBehind } from '@/engine/battery';
import { modelPath, isDownloaded } from '@/engine/downloads';
import { EMBEDDER_FILE } from '@/engine/models';
import { dataDir } from '@/engine/paths';
import { readPhotoText, ocrReady } from '@/engine/photo-ocr';
import { placeName } from '@/engine/places';
import { getSettings, updateSettings } from '@/engine/settings';
import { mayGrowMemory } from '@/engine/storage-guard';
import { EMBED_DIMS, getDb, vecParam } from './db';
import {
  folderOrigin,
  isImageFile,
  G_DONE,
  G_FAILED,
  G_NEW,
  G_READ,
  GALLERY_LIMITS,
  type GalleryItem,
  LIBRARY,
  libraryItem,
  photoDuty,
  PHOTO_BUDGET,
  photoIndexText,
  refillBudget,
  updateCost,
  planGallery,
  shownName,
} from './gallery-logic';
import { embedQuery, ftsQuery, fuseRankings } from './search-logic';
import { scheduleReclaim } from './reclaim';

const mediaLibrary = () => import('expo-media-library');

/**
 * Android has no Photos permission in this app (Play's photo policy, ADR 0006): photo search
 * reads photo folders the user picks with the system folder picker instead, which needs none.
 * The iPhone uses the Photos library with full or limited access.
 */
const isAndroid = Platform.OS === 'android';

/** Where the folder picker opens for the usual photo folders (the user taps "Use this folder"). */
export const PHOTO_FOLDERS = {
  camera: 'content://com.android.externalstorage.documents/document/primary%3ADCIM%2FCamera',
  screenshots:
    'content://com.android.externalstorage.documents/document/primary%3APictures%2FScreenshots',
};

/** Photo folders have their own origin, so the same folder can also be a files folder. */
export const photoFolderOrigin = (uri: string) => `photos:${uri}`;

export type PhotoAccess = 'all' | 'limited' | 'none';

/** Whether Sidekick may read the Photos library now (asks nothing). */
export async function photoAccess(): Promise<PhotoAccess> {
  if (isAndroid) return 'none';
  try {
    const ML = await mediaLibrary();
    const p = await ML.getPermissionsAsync(false, ['photo']);
    if (p.status !== 'granted') return 'none';
    return p.accessPrivileges === 'limited' ? 'limited' : 'all';
  } catch {
    return 'none';
  }
}

/**
 * Asks for the Photos permission (the system lets the user choose all photos or only some). Only
 * called from the Photos switch in Settings → Phone search.
 */
export async function askPhotoAccess(): Promise<PhotoAccess> {
  try {
    const ML = await mediaLibrary();
    const p = await ML.requestPermissionsAsync(false, ['photo']);
    if (p.status !== 'granted') return 'none';
    return p.accessPrivileges === 'limited' ? 'limited' : 'all';
  } catch (e) {
    console.log(`[gallery] permission: ${String(e)}`);
    return 'none';
  }
}

/** iPhone, limited access: lets the user change which photos Sidekick may see. */
export async function chooseMorePhotos(): Promise<PhotoAccess> {
  // iPhone only (Android picks photo folders instead).
  if (isAndroid) return 'none';
  const ML = await mediaLibrary();
  await ML.presentPermissionsPicker(['photo']);
  await markListed(null);
  return photoAccess();
}

async function meta(key: string): Promise<string | null> {
  const d = await getDb();
  const r = await d.execute('SELECT value FROM meta WHERE key = ?', [key]);
  return (r.rows[0]?.value as string | undefined) ?? null;
}

async function setMeta(key: string, value: string | null) {
  const d = await getDb();
  if (value == null) await d.execute('DELETE FROM meta WHERE key = ?', [key]);
  else await d.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}

const markListed = (at: number | null) => setMeta('gallery.listed', at == null ? null : String(at));

async function existing(origin: string) {
  const d = await getDb();
  const r = await d.execute('SELECT id, key, ver FROM gallery WHERE origin = ?', [origin]);
  return r.rows.map((x) => ({
    id: x.id as number,
    key: x.key as string,
    ver: (x.ver as string | null) ?? null,
  }));
}

async function deleteRows(ids: number[]) {
  if (!ids.length) return;
  const d = await getDb();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const marks = part.map(() => '?').join(',');
    await d.transaction(async (tx) => {
      await tx.execute(`DELETE FROM gallery_vec WHERE id IN (${marks})`, part);
      await tx.execute(`DELETE FROM gallery WHERE id IN (${marks})`, part);
    });
  }
  scheduleReclaim();
}

/** Makes the stored photos of [origin] match [items]; returns how many changed. */
export async function syncGalleryItems(origin: string, items: GalleryItem[]): Promise<number> {
  const plan = planGallery(await existing(origin), items);
  const d = await getDb();
  await d.transaction(async (tx) => {
    for (const i of plan.insert)
      await tx.execute(
        'INSERT OR IGNORE INTO gallery (key, origin, name, at, ver, state, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [i.key, origin, i.name, i.at, i.ver, G_NEW, photoIndexText(i.name, null)],
      );
    for (const u of plan.update)
      await tx.execute(
        'UPDATE gallery SET name = ?, at = ?, ver = ?, state = ?, text = ? WHERE id = ?',
        [u.name, u.at, u.ver, G_NEW, photoIndexText(u.name, null), u.id],
      );
  });
  await deleteRows(plan.remove);
  const n = plan.insert.length + plan.update.length + plan.remove.length;
  if (n)
    console.log(
      `[gallery] ${origin.slice(0, 40)}: +${plan.insert.length} ~${plan.update.length} -${plan.remove.length}`,
    );
  return n;
}

/** Lists the allowed Photos-library photos (metadata only) and updates the index. */
export async function listLibrary(): Promise<number> {
  if ((await photoAccess()) === 'none') {
    // Permission taken back in the phone's settings: what it allowed leaves the index.
    return syncGalleryItems(LIBRARY, []);
  }
  const ML = await mediaLibrary();
  const items: GalleryItem[] = [];
  for (let offset = 0; offset < GALLERY_LIMITS.maxPhotos; offset += GALLERY_LIMITS.page) {
    const page = await new ML.Query()
      .eq(ML.AssetField.MEDIA_TYPE, ML.MediaType.IMAGE)
      .orderBy({ key: ML.AssetField.CREATION_TIME, ascending: false })
      .limit(GALLERY_LIMITS.page)
      .offset(offset)
      .exeForMetadata();
    for (const a of page) {
      const item = libraryItem(a);
      if (a.mediaSubtypes?.includes(ML.MediaSubtype.SCREENSHOT) && !/screenshot/i.test(item.name))
        item.name = `Screenshot ${item.name}`.trim();
      items.push(item);
    }
    if (page.length < GALLERY_LIMITS.page) break;
  }
  return syncGalleryItems(LIBRARY, items);
}

let listener: { remove(): void } | null = null;

/** The library says it changed (a new photo, a delete): list it again at the next idle tick. */
async function watchLibrary(on: boolean) {
  if (!on) {
    listener?.remove();
    listener = null;
    return;
  }
  if (listener) return;
  try {
    const ML = await mediaLibrary();
    listener = ML.addListener(() => void markListed(null));
  } catch {
    // Not available: the half-hourly listing still catches changes.
  }
}

/** Turns photo search on (after the permission) or off (deletes the library's part of the index). */
export async function setPhotoSearch(on: boolean): Promise<PhotoAccess> {
  if (!on) {
    const { photoFolderUris } = getSettings();
    updateSettings({ sourceGallery: false, photoFolderUris: [] });
    await watchLibrary(false);
    await deleteOrigin(LIBRARY);
    for (const uri of photoFolderUris) await deleteOrigin(photoFolderOrigin(uri));
    return 'none';
  }
  if (isAndroid) {
    updateSettings({ sourceGallery: true });
    return 'none';
  }
  const access = await askPhotoAccess();
  if (access === 'none') return access;
  updateSettings({ sourceGallery: true });
  await markListed(null);
  await listLibrary();
  await markListed(Date.now());
  await watchLibrary(true);
  return access;
}

type ImageFile = { uri: string; name: string; modified: number };

function listImages(dir: Directory, depth: number, out: ImageFile[]) {
  if (depth > 4 || out.length >= GALLERY_LIMITS.maxPhotos) return;
  let items: (Directory | File)[] = [];
  try {
    items = dir.list();
  } catch (e) {
    console.log(`[gallery] can't list a photo folder: ${String(e)}`);
    return;
  }
  for (const item of items) {
    if (item instanceof Directory) {
      if (!item.name.startsWith('.')) listImages(item, depth + 1, out);
    } else if (isImageFile(item.name))
      out.push({ uri: item.uri, name: item.name, modified: item.modificationTime ?? 0 });
  }
}

async function listPhotoFolder(uri: string) {
  const images: ImageFile[] = [];
  listImages(new Directory(uri), 0, images);
  return syncFolderImages(uri, images, photoFolderOrigin(uri));
}

/** Android: lets the user pick a photo folder (opens at [initialUri]) and lists it. */
export async function addPhotoFolder(initialUri?: string): Promise<string | null> {
  let uri: string;
  try {
    uri = (await Directory.pickDirectoryAsync(initialUri)).uri;
  } catch (e) {
    // Cancelled.
    console.log(`[gallery] photo folder pick: ${String(e)}`);
    return null;
  }
  const uris = getSettings().photoFolderUris;
  updateSettings({
    sourceGallery: true,
    photoFolderUris: uris.includes(uri) ? uris : [...uris, uri],
  });
  await listPhotoFolder(uri);
  return uri;
}

/** Removes a photo folder: what was read from it is deleted (the photos are not touched). */
export async function removePhotoFolder(uri: string) {
  updateSettings({ photoFolderUris: getSettings().photoFolderUris.filter((u) => u !== uri) });
  await deleteOrigin(photoFolderOrigin(uri));
}

/** Deletes one origin's photos from the index (the photos themselves are not touched). */
export async function deleteOrigin(origin: string) {
  const d = await getDb();
  const r = await d.execute('SELECT id FROM gallery WHERE origin = ?', [origin]);
  await deleteRows(r.rows.map((x) => x.id as number));
}

/** Removes the whole photo index (Settings → Phone search → Remove the index). */
export async function removePhotoIndex() {
  const d = await getDb();
  await d.execute('DELETE FROM gallery_vec');
  await d.execute('DELETE FROM gallery');
  await markListed(null);
  scheduleReclaim();
}

export type GalleryStats = { photos: number; read: number; done: number; failed: number };

export async function galleryStats(): Promise<GalleryStats> {
  const d = await getDb();
  const r = await d.execute(
    `SELECT COUNT(*) AS n,
       SUM(CASE WHEN state != ${G_NEW} THEN 1 ELSE 0 END) AS r,
       SUM(CASE WHEN state = ${G_DONE} THEN 1 ELSE 0 END) AS v,
       SUM(CASE WHEN state = ${G_FAILED} THEN 1 ELSE 0 END) AS f FROM gallery`,
  );
  const x = r.rows[0] ?? {};
  return {
    photos: Number(x.n ?? 0),
    read: Number(x.r ?? 0),
    done: Number(x.v ?? 0),
    failed: Number(x.f ?? 0),
  };
}

const tmpDir = () => `${dataDir()}/search-tmp`;

/** A copy of one indexed photo at most [edge] px (null if it is gone or can't be read). */
async function prepare(ref: string, edge: number, name: string) {
  if (!SidekickNative.galleryPrepare) return null;
  try {
    return await SidekickNative.galleryPrepare(ref, edge, `${tmpDir()}/${name}`);
  } catch (e) {
    console.log(`[gallery] can't read a photo: ${String(e)}`);
    return null;
  }
}

/** Reads the text and place of one photo; state READ, or FAILED when it can't be opened. */
async function readOne(row: { id: number; key: string; name: string }) {
  const d = await getDb();
  const p = await prepare(row.key, GALLERY_LIMITS.readEdge, 'read.jpg');
  if (!p) {
    await d.execute('UPDATE gallery SET state = ? WHERE id = ?', [G_FAILED, row.id]);
    return;
  }
  let read: string | null = null;
  try {
    read = ocrReady() ? await readPhotoText(p.path) : null;
  } catch (e) {
    console.log(`[gallery] text: ${String(e)}`);
  }
  const lat = p.lat ?? null;
  const lon = p.lon ?? null;
  const place = lat != null && lon != null ? placeName({ lat, lon }) : null;
  await d.execute(
    'UPDATE gallery SET text = ?, lat = ?, lon = ?, place = ?, at = COALESCE(?, at), state = ? WHERE id = ?',
    [photoIndexText(row.name, read), lat, lon, place, p.takenAt ?? null, G_READ, row.id],
  );
  SidekickNative.deleteFile(p.path);
}

/** Gives one read photo its vector (same space as text questions). */
async function vectorOne(row: { id: number; key: string }) {
  const d = await getDb();
  const p = await prepare(row.key, 512, 'vec.jpg');
  if (!p) {
    await d.execute('UPDATE gallery SET state = ? WHERE id = ?', [G_FAILED, row.id]);
    return;
  }
  try {
    const [v] = await SidekickNative.embedImages(modelPath(EMBEDDER_FILE), [p.path], EMBED_DIMS);
    await d.execute('DELETE FROM gallery_vec WHERE id = ?', [row.id]);
    await d.execute('INSERT INTO gallery_vec (id, embedding) VALUES (?, ?)', [row.id, vecParam(v)]);
    await d.execute('UPDATE gallery SET state = ? WHERE id = ?', [G_DONE, row.id]);
  } catch (e) {
    console.log(`[gallery] vector: ${String(e)}`);
    await d.execute('UPDATE gallery SET state = ? WHERE id = ?', [G_FAILED, row.id]);
  }
  SidekickNative.deleteFile(p.path);
}

/** The share of time slow photo work may use now (0 = none; see gallery-logic photoDuty). */
async function dutyNow(): Promise<{ duty: number; charging: boolean }> {
  const s = getSettings();
  if (s.searchPaused || !mayGrowMemory()) return { duty: 0, charging: false };
  const { charging, lowPowerMode, batteryLevel } = await batteryState();
  let thermalStatus = 0;
  try {
    thermalStatus = SidekickNative.deviceState().thermalStatus;
  } catch {
    // Not available here: treated as cool.
  }
  const duty = photoDuty({
    charging,
    batteryLevel,
    lowPowerMode,
    thermalStatus,
    drainingOnCharger: chargerFallingBehind(),
  });
  return { duty, charging };
}

/** Measured ms per photo for each step on this phone (smoothed; first guesses until measured). */
const cost = { read: PHOTO_BUDGET.readMs, vector: PHOTO_BUDGET.vectorMs };
let costLoaded = false;
async function loadCosts() {
  if (costLoaded) return;
  costLoaded = true;
  cost.read = Number((await meta('gallery.cost.read')) ?? cost.read) || cost.read;
  cost.vector = Number((await meta('gallery.cost.vector')) ?? cost.vector) || cost.vector;
}
async function measured(kind: 'read' | 'vector', ms: number) {
  cost[kind] = updateCost(cost[kind], ms);
  await setMeta(`gallery.cost.${kind}`, String(cost[kind]));
}

/** Battery time saved up for slow work, and when it was last topped up. */
let budget = { tokensMs: 0, at: 0 };

/** The next photo to work on, newest first: text not read yet, else no vector yet. */
async function nextWork(vectors: boolean) {
  const d = await getDb();
  const r = await d.execute(
    `SELECT id, key, name, state FROM gallery WHERE state = ? ${vectors ? 'OR state = ?' : ''}
     ORDER BY CASE WHEN state = ? THEN 0 ELSE 1 END, at DESC LIMIT 1`,
    vectors ? [G_NEW, G_READ, G_NEW] : [G_NEW, G_NEW],
  );
  const x = r.rows[0];
  return x
    ? {
        id: x.id as number,
        key: x.key as string,
        name: x.name as string,
        kind: (x.state === G_NEW ? 'read' : 'vector') as 'read' | 'vector',
      }
    : null;
}

async function work(w: NonNullable<Awaited<ReturnType<typeof nextWork>>>) {
  const t0 = Date.now();
  if (w.kind === 'read') await readOne(w);
  else await vectorOne(w);
  const ms = Date.now() - t0;
  await measured(w.kind, ms);
  return ms;
}

/**
 * One idle tick: lists the library when due, then reads a few photos (text and place first, so
 * words are searchable soon, then vectors), newest first. Stops when [isBusy] says a question
 * started. Returns how many photos were worked on.
 */
export async function indexPhotosWhenIdle(isBusy: () => boolean, now = Date.now()) {
  if (indexing) return 0;
  indexing = true;
  try {
    return await indexTick(isBusy, now);
  } finally {
    indexing = false;
  }
}

let indexing = false;
let cleaned = false;

async function indexTick(isBusy: () => boolean, now: number) {
  if (!cleaned) {
    cleaned = true;
    cleanShownCopies(now);
  }
  const s = getSettings();
  const folderImages = s.sourceFolders && s.folderUris.length > 0;
  if (!s.sourceGallery && !folderImages) return 0;
  if (s.sourceGallery) {
    if (!isAndroid) await watchLibrary(true);
    const last = Number((await meta('gallery.listed')) ?? 0);
    if (!last || now - last >= GALLERY_LIMITS.scanEveryMs || last > now) {
      const list = isAndroid
        ? async () => {
            for (const uri of s.photoFolderUris) await listPhotoFolder(uri);
          }
        : listLibrary;
      await list().catch((e) => console.log(`[gallery] listing failed: ${String(e)}`));
      await markListed(now);
    }
  }
  if (isBusy()) return 0;
  const { duty, charging } = await dutyNow();
  budget.tokensMs = refillBudget(budget.tokensMs, budget.at || now, now, duty);
  budget.at = now;
  if (!duty) return 0;
  await loadCosts();
  const vectors = isDownloaded(EMBEDDER_FILE);
  // On the charger: a few photos per tick. On battery: only what the saved-up time pays for, at
  // the cost this phone measured for that step.
  const maxItems = charging ? GALLERY_LIMITS.readPerTick + GALLERY_LIMITS.vectorsPerTick : 4;
  let n = 0;
  while (n < maxItems && !isBusy()) {
    const w = await nextWork(vectors);
    if (!w) break;
    if (!charging && budget.tokensMs < cost[w.kind]) break;
    const ms = await work(w);
    if (!charging) budget.tokensMs = Math.max(0, budget.tokensMs - ms);
    n++;
  }
  return n;
}

/**
 * Search time: new photos (above all today's) appear in the index at once by name and date,
 * then the ones not read yet that the request may mean (in its time span, else the last day)
 * are read now, newest first, for at most a few seconds. Returns how many were read.
 */
export async function readRecentNow(
  opts: { from?: number; to?: number; now?: number; onProgress?: (n: number) => void } = {},
): Promise<number> {
  const now = opts.now ?? Date.now();
  await listRecent(now).catch((e) => console.log(`[gallery] recent listing: ${String(e)}`));
  if (!ocrReady() || getSettings().searchPaused) return 0;
  const from = opts.from ?? now - PHOTO_BUDGET.recentMs;
  const to = opts.to ?? now + 60_000;
  const d = await getDb();
  const r = await d.execute(
    'SELECT id, key, name FROM gallery WHERE state = ? AND at >= ? AND at < ? ORDER BY at DESC LIMIT ?',
    [G_NEW, from, to, PHOTO_BUDGET.onDemandMax],
  );
  const t0 = Date.now();
  let n = 0;
  for (const x of r.rows) {
    if (Date.now() - t0 >= PHOTO_BUDGET.onDemandMs) break;
    await work({ id: x.id as number, key: x.key as string, name: x.name as string, kind: 'read' });
    opts.onProgress?.(++n);
  }
  return n;
}

let recentListedAt = 0;

/**
 * Cheap listing of what's new since the last one (metadata only): a photo taken a minute ago is
 * in the index by name, date and folder before the search runs.
 */
async function listRecent(now: number) {
  const s = getSettings();
  if (!s.sourceGallery || now - recentListedAt < 30_000) return;
  recentListedAt = now;
  if (isAndroid) {
    for (const uri of s.photoFolderUris) await listPhotoFolder(uri);
    return;
  }
  if ((await photoAccess()) === 'none') return;
  const d = await getDb();
  const r = await d.execute('SELECT MAX(at) AS at FROM gallery WHERE origin = ?', [LIBRARY]);
  const newest = Number(r.rows[0]?.at ?? 0);
  const ML = await mediaLibrary();
  const page = await new ML.Query()
    .eq(ML.AssetField.MEDIA_TYPE, ML.MediaType.IMAGE)
    .gt(ML.AssetField.CREATION_TIME, Math.max(0, newest - 60_000))
    .orderBy({ key: ML.AssetField.CREATION_TIME, ascending: false })
    .limit(GALLERY_LIMITS.page)
    .exeForMetadata();
  const items = page.map(libraryItem);
  await d.transaction(async (tx) => {
    for (const i of items)
      await tx.execute(
        'INSERT OR IGNORE INTO gallery (key, origin, name, at, ver, state, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [i.key, LIBRARY, i.name, i.at, i.ver, G_NEW, photoIndexText(i.name, null)],
      );
  });
}

export type PhotoHit = {
  id: number;
  key: string;
  name: string;
  at: number;
  place: string | null;
  text: string;
};

/**
 * Indexed photos matching [query] by meaning (photo vectors) and by their words (read text),
 * best first, within [from, to) when given.
 */
export async function searchPhotos(
  query: string,
  opts: { from?: number; to?: number; k?: number; queryVec?: number[] | null } = {},
): Promise<PhotoHit[]> {
  const d = await getDb();
  const k = opts.k ?? 8;
  const ranged = opts.from != null || opts.to != null;
  const lists: number[][] = [];
  if (opts.queryVec) {
    const r = await d.execute(
      'SELECT id FROM gallery_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance',
      [vecParam(opts.queryVec), ranged ? 400 : k * 3],
    );
    lists.push(r.rows.map((x) => x.id as number));
  }
  const fq = ftsQuery(query);
  if (fq) {
    const r = await d.execute(
      'SELECT rowid AS id FROM gallery_fts WHERE gallery_fts MATCH ? ORDER BY rank LIMIT ?',
      [fq, ranged ? 400 : k * 3],
    );
    lists.push(r.rows.map((x) => x.id as number));
  }
  if (opts.queryVec) {
    // Recent photos with no vector yet can't match by meaning: they join the list, newest first,
    // so the model can still pick one (by its date, name or the text read so far).
    const since = opts.from ?? Date.now() - PHOTO_BUDGET.recentMs;
    const r = await d.execute(
      'SELECT id FROM gallery WHERE state != ? AND at >= ? AND at < ? ORDER BY at DESC LIMIT 3',
      [G_DONE, since, opts.to ?? Number.MAX_SAFE_INTEGER],
    );
    if (r.rows.length) lists.push(r.rows.map((x) => x.id as number));
  }
  let ids = fuseRankings(lists);
  if (!ids.length && ranged) {
    // Nothing matched by content in that time: its newest photos.
    const r = await d.execute(
      'SELECT id FROM gallery WHERE at >= ? AND at < ? ORDER BY at DESC LIMIT ?',
      [opts.from ?? 0, opts.to ?? Number.MAX_SAFE_INTEGER, k],
    );
    ids = r.rows.map((x) => x.id as number);
  }
  if (!ids.length) return [];
  const r = await d.execute(
    `SELECT id, key, name, at, place, text FROM gallery WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const byId = new Map(r.rows.map((x) => [x.id as number, x]));
  return ids
    .map((id) => byId.get(id))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => ({
      id: x.id as number,
      key: x.key as string,
      name: x.name as string,
      at: x.at as number,
      place: (x.place as string | null) ?? null,
      text: x.text as string,
    }))
    .filter((x) => (opts.from == null || x.at >= opts.from) && (opts.to == null || x.at < opts.to))
    .slice(0, k);
}

/** The question's vector (once per search; null if the embedder isn't downloaded). */
export async function queryVector(query: string): Promise<number[] | null> {
  if (!isDownloaded(EMBEDDER_FILE)) return null;
  try {
    const [v] = await SidekickNative.embed(
      modelPath(EMBEDDER_FILE),
      [embedQuery(query)],
      EMBED_DIMS,
    );
    return v;
  } catch (e) {
    console.log(`[gallery] query vector: ${String(e)}`);
    return null;
  }
}

const shownDir = () => `${dataDir()}/found`;

/**
 * A copy of a found photo for the chat (kept 2 days; the original is untouched). Null when the
 * photo is gone: then it also leaves the index.
 */
export async function shownCopy(ref: string): Promise<string | null> {
  if (!SidekickNative.galleryPrepare) return null;
  try {
    const p = await SidekickNative.galleryPrepare(
      ref,
      GALLERY_LIMITS.showEdge,
      `${shownDir()}/${shownName(ref)}`,
    );
    if (p) return p.path;
  } catch (e) {
    console.log(`[gallery] show: ${String(e)}`);
  }
  const d = await getDb();
  const r = await d.execute('SELECT id FROM gallery WHERE key = ?', [ref]);
  await deleteRows(r.rows.map((x) => x.id as number));
  return null;
}

/** Deletes chat copies of found photos older than 2 days. */
export function cleanShownCopies(now = Date.now()) {
  try {
    const dir = new Directory(`file://${shownDir()}`);
    if (!dir.exists) return;
    for (const f of dir.list())
      if (f instanceof File && now - (f.modificationTime ?? now) > 2 * 86_400_000) f.delete();
  } catch (e) {
    console.log(`[gallery] cleaning found copies: ${String(e)}`);
  }
}

/** Image files of one picked folder join phone search (sources.ts lists them while it reads). */
export async function syncFolderImages(
  folderUri: string,
  files: { uri: string; name: string; modified: number }[],
  origin = folderOrigin(folderUri),
) {
  return syncGalleryItems(
    origin,
    files.map((f) => ({
      key: f.uri,
      ver: String(f.modified),
      at: f.modified,
      name: f.name,
      origin,
    })),
  );
}

/** How the found item is opened: Android hands it to the phone's own app; false if it can't. */
export function openOriginal(ref: string, mime: string | null = null): boolean {
  return SidekickNative.openDocument?.(ref, mime) ?? false;
}

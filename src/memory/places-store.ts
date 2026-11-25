/**
 * Location memory in the encrypted database: the location track (where the phone was, while
 * Sidekick was listening or open) and the places the user named. Nothing here leaves the phone.
 */
import { getDb } from './db';
import type { Fix, NamedPlace } from '@/engine/location-logic';
import { NAMED_RADIUS_M } from '@/engine/location-logic';
import { haversineM } from '@/engine/place-logic';
import { mentionedName } from './search-logic';

const DDL = [
  `CREATE TABLE IF NOT EXISTS location_track (
     id INTEGER PRIMARY KEY,
     at INTEGER NOT NULL,
     lat REAL NOT NULL,
     lon REAL NOT NULL,
     acc_m REAL,
     speed_ms REAL,
     source TEXT NOT NULL DEFAULT 'fix'
   )`,
  'CREATE INDEX IF NOT EXISTS location_track_at ON location_track(at)',
  `CREATE TABLE IF NOT EXISTS named_places (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     lat REAL NOT NULL,
     lon REAL NOT NULL,
     radius_m REAL NOT NULL,
     created_at INTEGER NOT NULL
   )`,
];

let ready: Promise<void> | null = null;
async function db() {
  const d = await getDb();
  ready ??= (async () => {
    for (const sql of DDL) d.executeSync(sql);
  })();
  await ready;
  return d;
}

/** A new fix is stored only after this much movement or time (the native side also throttles). */
const MIN_MOVE_M = 40;
const MIN_GAP_MS = 4 * 60_000;
let last: Fix | null = null;

const toFix = (r: Record<string, unknown>): Fix => ({
  at: r.at as number,
  lat: r.lat as number,
  lon: r.lon as number,
  accM: (r.acc_m as number | null) ?? null,
  speedMs: (r.speed_ms as number | null) ?? null,
  source: r.source as string,
});

/** Stores a position; returns false when it was a near-duplicate of the last one. */
export async function addFix(f: Fix): Promise<boolean> {
  const d = await db();
  if (f.source !== 'parked') {
    last ??=
      (
        await d.execute(
          "SELECT * FROM location_track WHERE source = 'fix' ORDER BY at DESC LIMIT 1",
        )
      ).rows.map(toFix)[0] ?? null;
    if (last && f.at <= last.at) return false;
    if (last) {
      if (haversineM(last, f) < MIN_MOVE_M && f.at - last.at < MIN_GAP_MS) return false;
    }
    last = f;
  }
  await d.execute(
    'INSERT INTO location_track (at, lat, lon, acc_m, speed_ms, source) VALUES (?, ?, ?, ?, ?, ?)',
    [f.at, f.lat, f.lon, f.accM, f.speedMs ?? null, f.source ?? 'fix'],
  );
  return true;
}

export async function fixesBetween(from: number, to: number): Promise<Fix[]> {
  const d = await db();
  const r = await d.execute('SELECT * FROM location_track WHERE at >= ? AND at < ? ORDER BY at', [
    from,
    to,
  ]);
  return r.rows.map(toFix);
}

export async function trackSize(): Promise<number> {
  const d = await db();
  return (await d.execute('SELECT COUNT(*) AS n FROM location_track')).rows[0]?.n as number;
}

/** Deletes the whole location track (Settings → Location → Delete location history). */
export async function clearTrack() {
  const d = await db();
  await d.execute('DELETE FROM location_track');
  await d.execute('UPDATE moments SET lat = NULL, lon = NULL, place = NULL');
  last = null;
}

/** Drops fixes older than [days] (the memory keep period; 0 = keep). */
export async function pruneTrack(days: number, now = Date.now()) {
  if (!days) return;
  const d = await db();
  await d.execute('DELETE FROM location_track WHERE at < ?', [now - days * 86_400_000]);
}

export async function namedPlaces(): Promise<NamedPlace[]> {
  const d = await db();
  const r = await d.execute('SELECT * FROM named_places ORDER BY name');
  return r.rows.map((x) => ({
    id: x.id as number,
    name: x.name as string,
    lat: x.lat as number,
    lon: x.lon as number,
    radiusM: x.radius_m as number,
  }));
}

/** Names the spot [p]; a place with the same name moves there (renaming "home" after a move). */
export async function namePlace(
  name: string,
  p: { lat: number; lon: number },
): Promise<NamedPlace> {
  const d = await db();
  const same = (await namedPlaces()).find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (same) {
    await d.execute('UPDATE named_places SET lat = ?, lon = ? WHERE id = ?', [
      p.lat,
      p.lon,
      same.id,
    ]);
    return { ...same, lat: p.lat, lon: p.lon };
  }
  const r = await d.execute(
    'INSERT INTO named_places (name, lat, lon, radius_m, created_at) VALUES (?, ?, ?, ?, ?)',
    [name, p.lat, p.lon, NAMED_RADIUS_M, Date.now()],
  );
  return { id: r.insertId!, name, lat: p.lat, lon: p.lon, radiusM: NAMED_RADIUS_M };
}

export async function renamePlace(id: number, name: string) {
  const d = await db();
  await d.execute('UPDATE named_places SET name = ? WHERE id = ?', [name, id]);
}

export async function deletePlace(id: number) {
  const d = await db();
  await d.execute('DELETE FROM named_places WHERE id = ?', [id]);
}

/**
 * "What did Sam say at the gym": ids of moments recorded inside the named place the question
 * mentions, or null when it names none (store.ts narrows search results with these).
 */
export async function momentIdsAtNamedPlace(question: string): Promise<number[] | null> {
  const places = await namedPlaces();
  if (!places.length) return null;
  const name = mentionedName(
    question,
    places.flatMap((p) => [p.name, p.name.replace(/^(the|my) /i, '')]),
  );
  if (!name) return null;
  const p = places.find((x) => x.name === name || x.name.replace(/^(the|my) /i, '') === name)!;
  // A box around the circle (1° lat ≈ 111 km), then the exact distance.
  const dLat = p.radiusM / 111_000;
  const dLon = dLat / Math.max(0.1, Math.cos((p.lat * Math.PI) / 180));
  const d = await db();
  const r = await d.execute(
    'SELECT id, lat, lon FROM moments WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY at DESC LIMIT 500',
    [p.lat - dLat, p.lat + dLat, p.lon - dLon, p.lon + dLon],
  );
  return r.rows
    .filter((x) => haversineM(p, { lat: x.lat as number, lon: x.lon as number }) <= p.radiusM)
    .map((x) => x.id as number);
}

/** Test hook: forget the cached last fix. */
export function _resetPlacesStore() {
  last = null;
  ready = null;
}

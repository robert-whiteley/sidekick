/**
 * Recording the location track and reporting named-place changes. Kept apart from location.ts
 * so the memory store (which drains the native journal) can call `noteFix` without importing
 * the question-answering side.
 *
 * For routines: `onPlaceChange(listener)` reports entering and leaving places the user named
 * ({ type: 'enter' | 'leave', place, at }). It fires while Sidekick runs (listening or open) and a
 * new position arrives (every few minutes at most, or after moving ~100 m); not while the app is
 * fully closed. `currentNamedPlace()` is the place the phone was last seen in.
 */
import SidekickNative from '../../modules/sidekick-native';
import { type Fix, type NamedPlace, placeAt, type PlaceEvent, placeEvents } from './location-logic';
import { getSettings } from './settings';
import { addFix, namedPlaces } from '@/memory/places-store';

let places: NamedPlace[] | null = null;
let insideId: number | null = null;
const listeners = new Set<(e: PlaceEvent) => void>();

export async function allPlaces(): Promise<NamedPlace[]> {
  places ??= await namedPlaces().catch(() => []);
  return places;
}

/** After a place is named, moved or deleted. */
export function refreshPlaces(insideNow?: number | null) {
  places = null;
  if (insideNow !== undefined) insideId = insideNow;
}

/** Enter / leave events for named places (see the file comment). Returns an unsubscribe. */
export function onPlaceChange(fn: (e: PlaceEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The named place the phone was last seen in, or null. */
export function currentNamedPlace(): NamedPlace | null {
  return places?.find((p) => p.id === insideId) ?? null;
}

export function hasLocationPermission(): boolean {
  try {
    return SidekickNative.hasLocationPermission?.() ?? false;
  } catch {
    return false;
  }
}

/** Remembering positions: the setting is on, permission given, and not Off the record. */
export function locationMemoryOn(): boolean {
  const s = getSettings();
  return s.locationMemory !== false && !s.offTheRecord && hasLocationPermission();
}

/** Stores a position (from the native journal or the open app) and reports place changes. */
export async function noteFix(e: {
  at: number;
  lat: number;
  lon: number;
  accM?: number | null;
  speedMs?: number | null;
  source?: string;
}): Promise<boolean> {
  if (!locationMemoryOn()) return false;
  const fix: Fix = {
    at: e.at,
    lat: e.lat,
    lon: e.lon,
    accM: e.accM ?? null,
    speedMs: e.speedMs ?? null,
    source: e.source === 'parked' ? 'parked' : 'fix',
  };
  const added = await addFix(fix);
  if (added && fix.source === 'fix') {
    const all = await allPlaces();
    const now = placeAt(fix, all);
    const events = placeEvents(insideId, now, all, fix.at);
    insideId = now?.id ?? null;
    for (const ev of events)
      for (const l of listeners) {
        try {
          l(ev);
        } catch (err) {
          console.log(`[location] place listener failed: ${String(err)}`);
        }
      }
  }
  return added;
}

/** Test hook. */
export function _resetLocationTrack() {
  places = null;
  insideId = null;
  listeners.clear();
}

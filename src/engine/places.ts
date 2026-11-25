import { PermissionsAndroid, Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { geoPack } from './geo';
import { packNearest, packRegion } from './geo-pack';
import { DEFAULT_PAUSE_RADIUS_M, type LatLon, type PausePlace } from './place-logic';
import { setPlaceRegion } from './region';
import { getSettings, updateSettings } from './settings';

/** Where something happened: coordinates plus an offline place name ("Leeds, GB"). */
export type Here = LatLon & { place: string | null };

/** The nearest town or village ("Bloxham, GB"), offline; null if none within 30 km or no data. */
export function placeName(p: LatLon): string | null {
  const g = geoPack();
  return g ? packNearest(g, p) : null;
}

/** The phone's recent location (≤ 2 h old) with its place name, or null. Never waits. */
export function here(): Here | null {
  try {
    const l = SidekickNative.lastLocation();
    if (!l) return null;
    return { lat: l.lat, lon: l.lon, place: placeName(l) };
  } catch {
    return null;
  }
}

/** Country and US state (or other first-level region) for the last known location. */
export function currentRegion(): { country: string | null; admin1: string | null } {
  try {
    const l = SidekickNative.lastLocation();
    const g = geoPack();
    if (!l || !g) return { country: null, admin1: null };
    return packRegion(g, l);
  } catch {
    return { country: null, admin1: null };
  }
}

setPlaceRegion(currentRegion);

/** Optional: asks for location so memories get place names. Everything works without it. */
export async function askLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (SidekickNative.hasLocationPermission()) return true;
  const r = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  return Object.values(r).some((v) => v === PermissionsAndroid.RESULTS.GRANTED);
}

/** Sends quiet hours and paused places to the native listener. */
export function pushPauseRules() {
  const s = getSettings();
  SidekickNative.listenPauseRules(
    JSON.stringify({
      quietStart: s.quietHours ? s.quietStart : -1,
      quietEnd: s.quietHours ? s.quietEnd : -1,
      places: s.pausePlaces,
    }),
  );
}

/** Saves the current location as a place where listening pauses. */
export function addPausePlaceHere(name: string): PausePlace | null {
  const h = here();
  if (!h) return null;
  const p: PausePlace = {
    id: String(Date.now()),
    name: name.trim() || h.place?.split(',')[0] || 'This place',
    lat: h.lat,
    lon: h.lon,
    radiusM: DEFAULT_PAUSE_RADIUS_M,
  };
  updateSettings({ pausePlaces: [...getSettings().pausePlaces, p] });
  pushPauseRules();
  return p;
}

export function removePausePlace(id: string) {
  updateSettings({ pausePlaces: getSettings().pausePlaces.filter((p) => p.id !== id) });
  pushPauseRules();
}

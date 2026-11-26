/**
 * iPhone location for place names and "where am I" (Android does this natively in the listening
 * service). Uses expo-location only while the app is open, with "While Using the App" permission.
 * expo-location is linked on iPhone only, so it is required lazily.
 */
import type { DeviceLocation } from './SidekickNative.types';

type ExpoLocation = typeof import('expo-location');

let mod: ExpoLocation | null | undefined;
function loc(): ExpoLocation | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-location') as ExpoLocation;
    } catch {
      mod = null;
    }
  }
  return mod;
}

let granted = false;
let last: DeviceLocation | null = null;
let inFlight = false;
let checked = false;

const MAX_AGE_MS = 2 * 3_600_000;

/** Keeps the newest fix; ignores older ones that arrive late. */
export function keepFix(
  prev: DeviceLocation | null,
  next: DeviceLocation | null,
): DeviceLocation | null {
  if (!next) return prev;
  if (!prev || next.at >= prev.at) return next;
  return prev;
}

/** The cached fix if it is at most 2 h old. */
export function freshOrNull(l: DeviceLocation | null, now: number): DeviceLocation | null {
  return l && now - l.at <= MAX_AGE_MS ? l : null;
}

function toFix(p: {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  timestamp: number;
}): DeviceLocation {
  return {
    lat: p.coords.latitude,
    lon: p.coords.longitude,
    accuracyM: p.coords.accuracy ?? 0,
    at: p.timestamp,
  };
}

async function refresh() {
  const L = loc();
  if (!L || inFlight) return;
  inFlight = true;
  try {
    const perm = await L.getForegroundPermissionsAsync();
    granted = perm.granted;
    checked = true;
    if (!granted) return;
    const known = await L.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
    if (known) last = keepFix(last, toFix(known));
    const now = await L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced });
    last = keepFix(last, toFix(now));
  } catch {
    // No fix right now (indoors, Location Services off): keep the old one.
  } finally {
    inFlight = false;
  }
}

/** Freshest location at most 2 h old, or null. Also asks for a new fix in the background. */
export function iosLastLocation(): DeviceLocation | null {
  void refresh();
  return freshOrNull(last, Date.now());
}

export function iosHasLocationPermission(): boolean {
  if (!checked) void refresh();
  return granted;
}

/** Asks for "While Using the App" location; true when allowed. */
export async function iosAskLocation(): Promise<boolean> {
  const L = loc();
  if (!L) return false;
  try {
    const r = await L.requestForegroundPermissionsAsync();
    granted = r.granted;
    checked = true;
    if (granted) void refresh();
    return granted;
  } catch {
    return false;
  }
}

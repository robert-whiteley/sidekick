/** Places and auto-pause rules. Pure functions; tested. */

export type LatLon = { lat: number; lon: number };

/** A place where listening pauses (e.g. "Work", "Doctor"). */
export type PausePlace = LatLon & { id: string; name: string; radiusM: number };

export const DEFAULT_PAUSE_RADIUS_M = 150;

/** Bundled GeoNames table: coordinates are degrees × 10⁴. */
export type CityTable = {
  names: string[];
  lat: number[];
  lon: number[];
  pop?: number[];
  /** ISO 3166 country code ("GB"). */
  country?: string[];
  /** GeoNames admin1 code (for the US the state, e.g. "CA"). */
  admin1?: string[];
};

/** A bigger town this much further away still wins (city districts are listed as towns). */
const PREFER_BIGGER_WITHIN_KM = 5;

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The town or city (population ≥ 15 000) someone at [p] would say they are in, or null when none
 * is within [maxKm]. GeoNames also lists districts ("Paris 04 Hôtel-de-Ville") as towns, so among
 * places almost as close as the nearest one, the most populous wins.
 */
export function nearestCity(t: CityTable, p: LatLon, maxKm = 30): string | null {
  const i = nearestCityIndex(t, p, maxKm);
  if (i === null) return null;
  return t.country?.[i] ? `${t.names[i]}, ${t.country[i]}` : t.names[i];
}

/** Country and first-level region (US state) at [p], from the nearest town; nulls if unknown. */
export function regionAt(
  t: CityTable,
  p: LatLon,
  maxKm = 100,
): { country: string | null; admin1: string | null } {
  const i = nearestCityIndex(t, p, maxKm);
  if (i === null) return { country: null, admin1: null };
  return { country: t.country?.[i] || null, admin1: t.admin1?.[i] || null };
}

/** Index of the place [nearestCity] picks, or null. */
export function nearestCityIndex(t: CityTable, p: LatLon, maxKm = 30): number | null {
  const km = (i: number) => haversineM(p, { lat: t.lat[i] / 1e4, lon: t.lon[i] / 1e4 }) / 1000;
  // Fast scan with an equirectangular approximation (≈1 km/° error is fine for a shortlist).
  const cosLat = Math.cos(rad(p.lat));
  const near: number[] = [];
  let bestD = Infinity;
  const approxKm = new Float64Array(t.names.length);
  for (let i = 0; i < t.names.length; i++) {
    const dy = t.lat[i] / 1e4 - p.lat;
    let dx = Math.abs(t.lon[i] / 1e4 - p.lon);
    if (dx > 180) dx = 360 - dx;
    const d = Math.sqrt(dy * dy + dx * cosLat * (dx * cosLat)) * 111.2;
    approxKm[i] = d;
    if (d < bestD) bestD = d;
  }
  if (bestD > maxKm + 5) return null;
  for (let i = 0; i < t.names.length; i++) {
    if (approxKm[i] <= bestD + PREFER_BIGGER_WITHIN_KM + 1) near.push(i);
  }
  const exact = near.map((i) => ({ i, d: km(i) }));
  const nearest = Math.min(...exact.map((x) => x.d));
  if (nearest > maxKm) return null;
  const pop = (i: number) => t.pop?.[i] ?? 0;
  const pick = exact
    .filter((x) => x.d <= nearest + PREFER_BIGGER_WITHIN_KM)
    .reduce((a, b) => (pop(b.i) > pop(a.i) || (pop(b.i) === pop(a.i) && b.d < a.d) ? b : a));
  return pick.i;
}

/** The paused place [p] is inside, if any. */
export function insidePlace(p: LatLon, places: PausePlace[]): PausePlace | null {
  return places.find((x) => haversineM(p, x) <= x.radiusM) ?? null;
}

/** Minutes since midnight → "22:00". */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "7:30", "07:30", "22" → minutes since midnight; null if not a time. */
export function parseTime(s: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Is [nowMin] (minutes since midnight) inside quiet hours [start, end)? Handles overnight. */
export function inQuietHours(nowMin: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
}

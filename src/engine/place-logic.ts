/** Places and auto-pause rules. Pure functions; tested. */

export type LatLon = { lat: number; lon: number };

/** A place where listening pauses (e.g. "Work", "Doctor"). */
export type PausePlace = LatLon & { id: string; name: string; radiusM: number };

export const DEFAULT_PAUSE_RADIUS_M = 150;

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

/**
 * Location memory: questions about where the user is / was, places they named, visits, parking.
 * Pure functions; tested in __tests__/location-logic-test.ts. The data comes from
 * src/memory/places-store.ts (location track + named places, in the encrypted database).
 */
import { haversineM, type LatLon } from './place-logic';

/** One recorded position. `source`: 'fix' (a location update), 'parked' (car Bluetooth went). */
export type Fix = LatLon & {
  at: number;
  accM: number | null;
  speedMs?: number | null;
  source?: string;
};

/** A place the user named ("home", "the gym"). */
export type NamedPlace = LatLon & { id: number; name: string; radiusM: number };

/** A stay of ≥ MIN_VISIT_MS at one spot. */
export type Visit = LatLon & { from: number; to: number };

/** A spot visited on several days that the user hasn't named. */
export type FrequentPlace = LatLon & {
  visits: number;
  days: number;
  nightMs: number;
  totalMs: number;
};

export const NAMED_RADIUS_M = 120;
/** Fixes within this distance of a stay's first fix belong to the same stay. */
export const STAY_RADIUS_M = 150;
export const MIN_VISIT_MS = 10 * 60_000;
/**
 * The phone sends a fix only after moving (or every 15 min while listening): a fix stands for
 * where the user was until the next one, but no longer than this (then Sidekick wasn't running).
 */
export const FIX_VALID_MS = 20 * 60_000;
/** A frequent place: visits on at least this many different days. */
export const FREQUENT_DAYS = 3;
/** Faster than this between fixes (≈ 29 km/h) counts as driving. */
export const DRIVING_MS = 8;

const MIN = 60_000;
const HOUR = 3_600_000;

// --- Geometry ---

/** Compass direction from a to b ("north-west"). */
export function bearingWord(a: LatLon, b: LatLon): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const names = [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ];
  return names[Math.round(deg / 45) % 8];
}

/** "80 m", "1.2 km", "15 km". */
export function distanceText(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

/** The named place [p] is inside (closest first), or null. Accuracy widens the circle (≤ 100 m). */
export function placeAt(
  p: LatLon & { accM?: number | null },
  places: NamedPlace[],
): NamedPlace | null {
  let best: NamedPlace | null = null;
  let bestD = Infinity;
  for (const x of places) {
    const d = haversineM(p, x);
    if (d <= x.radiusM + Math.min(p.accM ?? 0, 100) && d < bestD) [best, bestD] = [x, d];
  }
  return best;
}

/** "home" → "home"; "the gym" → "the gym"; "Gym" → "Gym". As said after "at". */
export function atPhrase(name: string): string {
  return /^(home)$/i.test(name) ? 'home' : name;
}

// --- Stays and places ---

/** Stays of ≥ 10 minutes from fixes (sorted by time), each fix valid until the next one (≤ 20 min). */
export function visitsFrom(fixes: Fix[], minMs = MIN_VISIT_MS): Visit[] {
  const out: Visit[] = [];
  const pts = fixes.filter((f) => f.source !== 'parked').sort((a, b) => a.at - b.at);
  let i = 0;
  while (i < pts.length) {
    const anchor = pts[i];
    let j = i;
    let sumLat = anchor.lat;
    let sumLon = anchor.lon;
    while (
      j + 1 < pts.length &&
      haversineM(anchor, pts[j + 1]) <= STAY_RADIUS_M &&
      pts[j + 1].at - pts[j].at <= FIX_VALID_MS
    ) {
      j++;
      sumLat += pts[j].lat;
      sumLon += pts[j].lon;
    }
    const next = pts[j + 1];
    const end = Math.min(pts[j].at + FIX_VALID_MS, next ? next.at : Infinity);
    const n = j - i + 1;
    if (end - anchor.at >= minMs)
      out.push({ lat: sumLat / n, lon: sumLon / n, from: anchor.at, to: end });
    i = j + 1;
  }
  return out;
}

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** Time of [v] between midnight and 06:00 (where the user sleeps = probably home). */
function nightMs(v: Visit): number {
  let ms = 0;
  for (let t = v.from; t < v.to; t += 10 * MIN) {
    const h = new Date(t).getHours();
    if (h < 6) ms += Math.min(10 * MIN, v.to - t);
  }
  return ms;
}

/** Spots visited on ≥ 3 different days that aren't inside a named place, most visited first. */
export function frequentPlaces(visits: Visit[], named: NamedPlace[]): FrequentPlace[] {
  const groups: { lat: number; lon: number; vs: Visit[] }[] = [];
  for (const v of visits) {
    if (placeAt(v, named)) continue;
    const g = groups.find((x) => haversineM(x, v) <= STAY_RADIUS_M);
    if (g) {
      g.vs.push(v);
      g.lat = g.vs.reduce((s, x) => s + x.lat, 0) / g.vs.length;
      g.lon = g.vs.reduce((s, x) => s + x.lon, 0) / g.vs.length;
    } else groups.push({ lat: v.lat, lon: v.lon, vs: [v] });
  }
  return groups
    .map((g) => ({
      lat: g.lat,
      lon: g.lon,
      visits: g.vs.length,
      days: new Set(g.vs.map((v) => dayKey(v.from))).size,
      nightMs: g.vs.reduce((s, v) => s + nightMs(v), 0),
      totalMs: g.vs.reduce((s, v) => s + v.to - v.from, 0),
    }))
    .filter((g) => g.days >= FREQUENT_DAYS)
    .sort((a, b) => b.days - a.days || b.totalMs - a.totalMs);
}

/** The frequent place where most nights are spent (≥ 2 h of night time in total), or null. */
export function likelyHome(frequent: FrequentPlace[]): FrequentPlace | null {
  const best = [...frequent].sort((a, b) => b.nightMs - a.nightMs)[0];
  return best && best.nightMs >= 2 * HOUR ? best : null;
}

/**
 * Where the car was left: the latest 'parked' mark (car Bluetooth disconnected), or else the first
 * fix after the last stretch faster than 29 km/h. Null if neither.
 */
export function parkedSpot(fixes: Fix[]): Fix | null {
  const pts = [...fixes].sort((a, b) => a.at - b.at);
  const marks = pts.filter((f) => f.source === 'parked');
  let lastDriveEnd: Fix | null = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.source === 'parked' || b.source === 'parked') continue;
    const dt = (b.at - a.at) / 1000;
    const speed = b.speedMs ?? (dt > 0 ? haversineM(a, b) / dt : 0);
    if (speed >= DRIVING_MS && dt <= 15 * 60) {
      // The car stops at the next fix that is slow.
      const stop = pts.slice(i + 1).find((c) => c.source !== 'parked' && (c.speedMs ?? 0) < 2);
      lastDriveEnd = stop ?? b;
    }
  }
  const mark = marks[marks.length - 1] ?? null;
  if (mark && (!lastDriveEnd || mark.at >= lastDriveEnd.at - 5 * MIN)) return mark;
  return lastDriveEnd ?? mark;
}

/** Where the user was at [t]: the fix before it (≤ 20 min old) or, failing that, one ≤ 10 min after. */
export function fixAt(fixes: Fix[], t: number): Fix | null {
  let before: Fix | null = null;
  let after: Fix | null = null;
  for (const f of fixes) {
    if (f.source === 'parked') continue;
    if (f.at <= t && (!before || f.at > before.at)) before = f;
    if (f.at > t && (!after || f.at < after.at)) after = f;
  }
  if (before && t - before.at <= FIX_VALID_MS) return before;
  if (after && after.at - t <= 10 * MIN) return after;
  return null;
}

/** Time spent inside [place] during [from, to), from stays. */
export function timeAt(visits: Visit[], place: NamedPlace, from: number, to: number): number {
  let ms = 0;
  for (const v of visits) {
    if (haversineM(v, place) > place.radiusM + 50) continue;
    ms += Math.max(0, Math.min(v.to, to) - Math.max(v.from, from));
  }
  return ms;
}

/** "2 h 15 min", "40 min". */
export function durationText(ms: number): string {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

// --- Enter / leave events ---

export type PlaceEvent = { type: 'enter' | 'leave'; place: NamedPlace; at: number };

/** Events from moving from the place [prev] (id or null) to [now]'s place. */
export function placeEvents(
  prevId: number | null,
  now: NamedPlace | null,
  places: NamedPlace[],
  at: number,
): PlaceEvent[] {
  if ((now?.id ?? null) === prevId) return [];
  const out: PlaceEvent[] = [];
  const prev = places.find((p) => p.id === prevId);
  if (prev) out.push({ type: 'leave', place: prev, at });
  if (now) out.push({ type: 'enter', place: now, at });
  return out;
}

// --- Questions ---

export type LocationQuestion =
  | { kind: 'name'; name: string }
  | { kind: 'forget'; name: string | null }
  | { kind: 'whereNow' }
  | { kind: 'whereAt'; at: number; label: string }
  | { kind: 'parked' }
  | { kind: 'lastAt'; name: string }
  | { kind: 'howLong'; name: string }
  | { kind: 'placesIn' };

/** Kinds of place people name themselves in "this is my …". */
const PLACE_NOUN =
  /^(home|house|flat|apartment|office|work|workplace|gym|school|college|uni|university|studio|shop|garage|garden|allotment|cabin|caravan|hotel|airbnb|desk|clinic|surgery|church|mosque|temple|club|pub|local|cafe|café|bar|parking spot|parking space|car park|(?:[a-z']+ )?(?:house|home|place|flat|office|work|school|gym|room))$/i;

function cleanName(s: string): string {
  return s
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:called|named)\s+/i, '')
    .replace(/\s+/g, ' ');
}

/** "my home" → "home", "the gym" → "the gym" (kept), "my mum's house" → "mum's house". */
export function normalisePlaceName(s: string): string {
  return cleanName(s).replace(/^my\s+/i, '');
}

/** Is it a question about location that this module answers? */
export function parseLocationQuestion(q: string, now: Date): LocationQuestion | null {
  const s = q.trim().replace(/\s+/g, ' ');
  const l = s.toLowerCase().replace(/[’]/g, "'");

  let m =
    /^(?:please )?(?:call|name|save|mark|remember|label) (?:this place|this spot|where i am|this|here)(?: as| place as)? (.{2,40})$/i.exec(
      s,
    ) ?? /^(?:this place is called|this place is|here is|this is) (.{2,40})$/i.exec(s);
  if (m) {
    const name = normalisePlaceName(m[1]);
    const placeWord = /^(?:this is|here is) /i.test(s) ? PLACE_NOUN.test(name) : true;
    if (name && placeWord && !/\b(it|that|a|an)$/i.test(name)) return { kind: 'name', name };
  }
  m =
    /^(?:please )?(?:forget|delete|remove) (?:this place|this spot|here|the place(?: called)? (.{2,40}))$/i.exec(
      s,
    );
  if (m) return { kind: 'forget', name: m[1] ? normalisePlaceName(m[1]) : null };

  if (
    /\b(where('s| is) my car|where did i (park|leave (my|the) car)|where have i parked|where('s| is) the car( parked)?|find my car)\b/.test(
      l,
    )
  )
    return { kind: 'parked' };

  if (
    /\b(where am i|where are we|what('s| is) my (location|address)|what (town|city|place|area|street|road) (am i|are we|is this)( in| on)?|which (town|city|street|road) (am i|are we|is this)( in| on)?|where('s| is) (this|here))\b/.test(
      l,
    )
  )
    return { kind: 'whereNow' };

  m =
    /\bwhen (?:was|were) (?:i|we) (?:last |most recently )?(?:at|in) (.{2,40}?)\??$/i.exec(s) ??
    /\bwhen did (?:i|we) (?:last )?(?:go to|visit|leave|get to|arrive at) (.{2,40}?)( last)?\??$/i.exec(
      s,
    );
  if (m) return { kind: 'lastAt', name: normalisePlaceName(m[1].replace(/\s+last$/i, '')) };

  m =
    /\bhow long (?:was|were|have) (?:i|we) (?:been )?(?:at|in) (.{2,40}?)(?: (?:today|yesterday|this week|last week|this morning|on \w+day))?\??$/i.exec(
      s,
    );
  if (m) return { kind: 'howLong', name: normalisePlaceName(m[1]) };

  if (
    /\b(where (have|did) (i|we) (been|go|went)|what places (did|have) (i|we)|places i('ve| have)? (been|went|visited))\b/.test(
      l,
    )
  )
    return { kind: 'placesIn' };

  if (/\bwhere (was|were) (i|we)\b/.test(l) && !/\bwhen\b/.test(l)) {
    const t = pointInTime(l, now);
    if (t) return { kind: 'whereAt', ...t };
  }
  return null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * A moment in time said in words: "at 3pm yesterday", "on Tuesday at noon", "at 15:30",
 * "2 hours ago", "this morning" (its middle). Null if none. Never in the future.
 */
export function pointInTime(q: string, now: Date): { at: number; label: string } | null {
  const s = q.toLowerCase();
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  let dayLabel = '';
  let dayGiven = false;
  if (/\byesterday\b|\blast night\b/.test(s)) {
    day.setDate(day.getDate() - 1);
    dayLabel = 'yesterday';
    dayGiven = true;
  } else {
    const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(s));
    if (wd >= 0) {
      let back = (now.getDay() - wd + 7) % 7;
      if (back === 0) back = 7;
      day.setDate(day.getDate() - back);
      dayLabel = `on ${WEEKDAYS[wd][0].toUpperCase()}${WEEKDAYS[wd].slice(1)}`;
      dayGiven = true;
    } else if (/\btoday\b/.test(s)) dayGiven = true;
  }

  const ago = /\b(an?|\d+|a couple of|a few) (minute|hour)s? ago\b/.exec(s);
  if (ago) {
    const n =
      ({ a: 1, an: 1, 'a couple of': 2, 'a few': 3 } as Record<string, number>)[ago[1]] ??
      Number(ago[1]);
    const at = now.getTime() - n * (ago[2] === 'hour' ? HOUR : MIN);
    return { at, label: `${n} ${ago[2]}${n === 1 ? '' : 's'} ago` };
  }

  let h: number | null = null;
  let min = 0;
  let ampm: string | undefined;
  const clock =
    /\b(?:at|around|about|by) (\d{1,2})(?:[:.](\d{2}))? ?(am|pm|a\.m\.|p\.m\.|o'clock)?\b/.exec(
      s,
    ) ?? /\b(\d{1,2})(?:[:.](\d{2}))? ?(am|pm|a\.m\.|p\.m\.)\b/.exec(s);
  if (clock) {
    h = Number(clock[1]);
    min = Number(clock[2] ?? 0);
    ampm = clock[3]?.replace(/\./g, '');
    if (h > 23 || min > 59) h = null;
  } else if (/\b(noon|midday|lunchtime|lunch time)\b/.test(s)) h = /lunch/.test(s) ? 13 : 12;
  else if (/\bmidnight\b/.test(s)) h = 0;
  else if (/\bmorning\b/.test(s)) h = 9;
  else if (/\bafternoon\b/.test(s)) h = 15;
  else if (/\b(evening|tonight|last night)\b/.test(s)) h = 20;
  if (h === null) return null;

  const at = (hour: number) => day.getTime() + hour * HOUR + min * MIN;
  let hour = h;
  if (ampm === 'pm' && h < 12) hour = h + 12;
  else if (ampm === 'am' && h === 12) hour = 0;
  else if (!ampm && clock && h >= 1 && h <= 11) {
    // "at 3": today, the latest of 03:00 / 15:00 that has passed; on another day, 1–6 means pm.
    if (dayGiven && day.getTime() < now.getTime() - 24 * HOUR + 1) hour = h < 7 ? h + 12 : h;
    else if (dayLabel === 'yesterday') hour = h < 7 ? h + 12 : h;
    else hour = at(h + 12) <= now.getTime() ? h + 12 : h;
  }
  let t = at(hour);
  let label = dayLabel;
  if (t > now.getTime() && !dayGiven) {
    t -= 24 * HOUR;
    label = 'yesterday';
  }
  if (t > now.getTime()) return null;
  const hh = new Date(t);
  const time = `${String(hh.getHours()).padStart(2, '0')}:${String(hh.getMinutes()).padStart(2, '0')}`;
  return { at: t, label: `at ${time}${label ? ` ${label}` : ''}` };
}

/** Finds the named place the question means ("the gym" ↔ "gym"), or null. */
export function findPlace(name: string, places: NamedPlace[]): NamedPlace | null {
  const key = (s: string) =>
    s
      .toLowerCase()
      .replace(/^(the|my) /, '')
      .replace(/[^a-z0-9' ]/g, '')
      .trim();
  const k = key(name);
  return (
    places.find((p) => key(p.name) === k) ??
    places.find((p) => k.includes(key(p.name)) && key(p.name).length >= 3) ??
    null
  );
}

/** "14:05", "yesterday at 14:05", "on Tue 3 Dec at 14:05". */
export function whenText(t: number, now: Date): string {
  const d = new Date(t);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (t >= start.getTime()) return `today at ${time}`;
  if (t >= start.getTime() - 24 * HOUR) return `yesterday at ${time}`;
  if (t >= start.getTime() - 6 * 24 * HOUR)
    return `on ${WEEKDAYS[d.getDay()][0].toUpperCase()}${WEEKDAYS[d.getDay()].slice(1)} at ${time}`;
  return `on ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${time}`;
}

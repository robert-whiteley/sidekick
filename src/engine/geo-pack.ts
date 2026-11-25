/**
 * Offline place names: every town and village with ≥ 500 people (GeoNames cities500, CC BY 4.0),
 * packed by scripts/build-places.mjs into the native module's assets (geo/places500.bin, ~5 MB,
 * ~2.7 MB compressed in the app). Pure reader, no I/O: the bytes come from native (places.ts).
 *
 * Format (little-endian), rows sorted by latitude:
 *   0  "SKG1", u32 version, u32 N, u32 countries, u32 regions, u32 nameBytes, u32 regionBytes, u32 0
 *   32 i32 lat[N] (° × 1e4), i32 lon[N], u16 region[N], u8 country[N], u8 popLog[N]
 *      (round(log2(pop + 1) × 8)), u8 nameLen[N]; padded to 4
 *   then countries × 2 ASCII bytes, region codes joined by "\n" (index 0 = none), names (UTF-8).
 */
import { haversineM, type LatLon } from './place-logic';

export type GeoPack = {
  n: number;
  lat: Int32Array;
  lon: Int32Array;
  region: Uint16Array;
  country: Uint8Array;
  pop: Uint8Array;
  nameLen: Uint8Array;
  nameAt: Uint32Array;
  names: Uint8Array;
  countries: string[];
  regions: string[];
};

const MAGIC = 0x3147_4b53; // "SKG1"

/** Parses the pack (views over [bytes], no copy of the big arrays). Throws if it isn't one. */
export function parseGeoPack(bytes: Uint8Array): GeoPack {
  // Typed-array views need aligned offsets: copy once if the buffer slice isn't aligned.
  const b = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a place pack');
  const n = dv.getUint32(8, true);
  const nCountries = dv.getUint32(12, true);
  const namesLen = dv.getUint32(20, true);
  const regionLen = dv.getUint32(24, true);
  let o = b.byteOffset + 32;
  const lat = new Int32Array(b.buffer, o, n);
  o += 4 * n;
  const lon = new Int32Array(b.buffer, o, n);
  o += 4 * n;
  const region = new Uint16Array(b.buffer, o, n);
  o += 2 * n;
  const country = new Uint8Array(b.buffer, o, n);
  o += n;
  const pop = new Uint8Array(b.buffer, o, n);
  o += n;
  const nameLen = new Uint8Array(b.buffer, o, n);
  o += n;
  o = b.byteOffset + ((o - b.byteOffset + 3) & ~3);
  const countries: string[] = [];
  for (let i = 0; i < nCountries; i++) {
    countries.push(String.fromCharCode(b[o - b.byteOffset], b[o - b.byteOffset + 1]).trim());
    o += 2;
  }
  const regions = utf8(new Uint8Array(b.buffer, o, regionLen)).split('\n');
  o += regionLen;
  const names = new Uint8Array(b.buffer, o, namesLen);
  const nameAt = new Uint32Array(n);
  let at = 0;
  for (let i = 0; i < n; i++) {
    nameAt[i] = at;
    at += nameLen[i];
  }
  return { n, lat, lon, region, country, pop, nameLen, nameAt, names, countries, regions };
}

/** Small UTF-8 decoder (Hermes has no TextDecoder everywhere). */
export function utf8(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length;) {
    const c = u[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (u[i++] & 0x3f);
    else if (c < 0xf0) cp = ((c & 0x0f) << 12) | ((u[i++] & 0x3f) << 6) | (u[i++] & 0x3f);
    else
      cp = ((c & 0x07) << 18) | ((u[i++] & 0x3f) << 12) | ((u[i++] & 0x3f) << 6) | (u[i++] & 0x3f);
    s += String.fromCodePoint(cp);
  }
  return s;
}

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

export function packName(g: GeoPack, i: number): string {
  return utf8(g.names.subarray(g.nameAt[i], g.nameAt[i] + g.nameLen[i]));
}

/** "Bloxham, GB". */
export function packLabel(g: GeoPack, i: number): string {
  const cc = g.countries[g.country[i]];
  return cc ? `${packName(g, i)}, ${cc}` : packName(g, i);
}

/** First row with lat ≥ [v] (× 1e4). */
function lowerBound(a: Int32Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A place this much further away still wins if it is bigger (same rule as place-logic.ts). */
const PREFER_BIGGER_WITHIN_KM = 5;
/** Log-population steps that count as "bigger" (8 = twice the people). */
const BIGGER_STEPS = 8;

/**
 * The place to name [p] by: the nearest town or village within [maxKm], unless one at least twice
 * as big is at most 5 km further (a village on a town's edge is named after the town). Null if none.
 */
export function nearestPlaceIndex(g: GeoPack, p: LatLon, maxKm = 30): number | null {
  const bandDeg = (maxKm + PREFER_BIGGER_WITHIN_KM + 1) / 111.2;
  const from = lowerBound(g.lat, Math.floor((p.lat - bandDeg) * 1e4));
  const to = lowerBound(g.lat, Math.ceil((p.lat + bandDeg) * 1e4));
  const cosLat = Math.max(0.01, Math.cos((p.lat * Math.PI) / 180));
  const near: { i: number; d: number }[] = [];
  let best = Infinity;
  for (let i = from; i < to; i++) {
    const dy = g.lat[i] / 1e4 - p.lat;
    let dx = Math.abs(g.lon[i] / 1e4 - p.lon);
    if (dx > 180) dx = 360 - dx;
    const approx = Math.sqrt(dy * dy + dx * cosLat * (dx * cosLat)) * 111.2;
    if (approx > maxKm + PREFER_BIGGER_WITHIN_KM + 1) continue;
    const d = haversineM(p, { lat: g.lat[i] / 1e4, lon: g.lon[i] / 1e4 }) / 1000;
    near.push({ i, d });
    if (d < best) best = d;
  }
  if (best > maxKm) return null;
  const nearest = near.reduce((a, b) => (b.d < a.d ? b : a));
  let pick = nearest;
  for (const x of near) {
    if (x.d > best + PREFER_BIGGER_WITHIN_KM) continue;
    if (g.pop[x.i] >= g.pop[nearest.i] + BIGGER_STEPS && g.pop[x.i] > g.pop[pick.i]) pick = x;
  }
  return pick.i;
}

export function packNearest(g: GeoPack, p: LatLon, maxKm = 30): string | null {
  const i = nearestPlaceIndex(g, p, maxKm);
  return i == null ? null : packLabel(g, i);
}

/** Country and first-level region (US state) at [p]; nulls if unknown. */
export function packRegion(
  g: GeoPack,
  p: LatLon,
  maxKm = 100,
): { country: string | null; admin1: string | null } {
  const i = nearestPlaceIndex(g, p, maxKm);
  if (i == null) return { country: null, admin1: null };
  return { country: g.countries[g.country[i]] || null, admin1: g.regions[g.region[i]] || null };
}

/** The biggest place with that name ("banbury" → Banbury, GB), or null. */
export function packFind(
  g: GeoPack,
  name: string,
): { name: string; lat: number; lon: number; country: string | null } | null {
  const k = name.toLowerCase().replace(/^the /, '').trim();
  if (k.length < 3) return null;
  // UTF-8 length of the name: only rows of that length are decoded and compared.
  const len = utf8Length(k);
  let best = -1;
  for (let i = 0; i < g.n; i++) {
    const l = g.nameLen[i];
    if (l < len - 2 || l > len + 2) continue;
    if (packName(g, i).toLowerCase() !== k) continue;
    if (best < 0 || g.pop[i] > g.pop[best]) best = i;
  }
  if (best < 0) return null;
  return {
    name: packName(g, best),
    lat: g.lat[best] / 1e4,
    lon: g.lon[best] / 1e4,
    country: g.countries[g.country[best]] || null,
  };
}

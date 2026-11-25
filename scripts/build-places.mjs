// Builds the offline place-name pack from GeoNames' cities500.txt (CC BY 4.0, https://www.geonames.org/):
// every populated place with ≥ 500 people (towns and villages), packed small for the phone.
//   curl -LO https://download.geonames.org/export/dump/cities500.zip && unzip cities500.zip
//   node scripts/build-places.mjs cities500.txt
// Output: modules/sidekick-native/android/src/main/assets/geo/places500.bin (read by
// src/engine/geo-pack.ts; format documented there). Sorted by latitude for a fast band search.
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'modules/sidekick-native/android/src/main/assets/geo/places500.bin';
const rows = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('\t'))
  .filter((c) => c[7] !== 'PPLX') // city sections ("Bur Dubai"): the city itself is listed
  .map((c) => ({
    name: c[1],
    lat: Math.round(Number(c[4]) * 1e4),
    lon: Math.round(Number(c[5]) * 1e4),
    cc: (c[8] || '').slice(0, 2).padEnd(2, ' '),
    admin1: c[10] || '',
    pop: Number(c[14]) || 0,
  }))
  .sort((a, b) => a.lat - b.lat);

const enc = new TextEncoder();
const countries = [...new Set(rows.map((r) => r.cc))].sort();
const admin1 = ['', ...[...new Set(rows.map((r) => r.admin1).filter(Boolean))].sort()];
if (countries.length > 255 || admin1.length > 65535) throw new Error('table too big');
const cIdx = new Map(countries.map((c, i) => [c, i]));
const aIdx = new Map(admin1.map((a, i) => [a, i]));
const nameBytes = rows.map((r) => {
  let b = enc.encode(r.name);
  if (b.length > 255) b = b.slice(0, 255);
  return b;
});
const N = rows.length;
const namesLen = nameBytes.reduce((s, b) => s + b.length, 0);
const admin1Blob = enc.encode(admin1.join('\n'));
const pad4 = (n) => (n + 3) & ~3;
const fixed = 32 + 8 * N + 2 * N + 3 * N;
const total = pad4(fixed) + countries.length * 2 + admin1Blob.length + namesLen;
const buf = new ArrayBuffer(total);
const dv = new DataView(buf);
const u8 = new Uint8Array(buf);
u8.set(enc.encode('SKG1'), 0);
[1, N, countries.length, admin1.length, namesLen, admin1Blob.length, 0].forEach((v, i) =>
  dv.setUint32(4 + 4 * i, v, true),
);
let o = 32;
for (const r of rows) dv.setInt32((o += 4) - 4, r.lat, true);
for (const r of rows) dv.setInt32((o += 4) - 4, r.lon, true);
for (const r of rows) dv.setUint16((o += 2) - 2, aIdx.get(r.admin1), true);
for (const r of rows) u8[o++] = cIdx.get(r.cc);
// Population on a log scale (8 steps per doubling): only compared, never shown.
for (const r of rows) u8[o++] = Math.min(255, Math.round(Math.log2(r.pop + 1) * 8));
for (const b of nameBytes) u8[o++] = b.length;
o = pad4(o);
for (const c of countries) u8.set(enc.encode(c), (o += 2) - 2);
u8.set(admin1Blob, o);
o += admin1Blob.length;
for (const b of nameBytes) {
  u8.set(b, o);
  o += b.length;
}
writeFileSync(OUT, u8);
console.log(`${N} places, ${countries.length} countries, ${admin1.length} regions, ${total} bytes`);

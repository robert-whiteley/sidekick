// Builds assets/geonames/cities15000.json from GeoNames' cities15000.txt (CC BY 4.0).
// The upstream file changes daily, so a compact copy is bundled instead of downloaded:
//   curl -LO https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
//   node scripts/build-cities.mjs cities15000.txt
import { readFileSync, writeFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('\t'))
  .filter((c) => c[7] !== 'PPLX') // city sections
  // name, latitude, longitude, country code, population
  .map((c) => [
    c[1],
    Math.round(Number(c[4]) * 1e4),
    Math.round(Number(c[5]) * 1e4),
    c[8],
    Number(c[14]),
    c[10],
  ]);
const out = {
  source: 'GeoNames cities15000 (CC BY 4.0), https://www.geonames.org/',
  names: rows.map((r) => r[0]),
  // ISO country code and GeoNames admin1 code (US: state abbreviation, e.g. "CA").
  country: rows.map((r) => r[3]),
  admin1: rows.map((r) => r[5]),
  lat: rows.map((r) => r[1]),
  lon: rows.map((r) => r[2]),
  pop: rows.map((r) => r[4]),
};
writeFileSync('assets/geonames/cities15000.json', JSON.stringify(out));
console.log(`${rows.length} places`);

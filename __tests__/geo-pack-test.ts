import { parseGeoPack, packFind, packNearest, packRegion, utf8 } from '@/engine/geo-pack';

declare const __dirname: string;
const fs = jest.requireActual<{ readFileSync: (p: string) => Uint8Array }>('fs');
const bytes = new Uint8Array(
  fs.readFileSync(
    `${__dirname}/../modules/sidekick-native/android/src/main/assets/geo/places500.bin`,
  ),
);
const g = parseGeoPack(bytes);

test('the bundled pack has towns and villages', () => {
  expect(g.n).toBeGreaterThan(200_000);
  expect(packNearest(g, { lat: 53.7965, lon: -1.5478 })).toBe('Leeds, GB');
  expect(packNearest(g, { lat: 48.8566, lon: 2.3522 })).toBe('Paris, FR');
  // Bloxham, a village of ~3,500 about 5 km from Banbury: named itself, not the town.
  expect(packNearest(g, { lat: 52.0205, lon: -1.3735 })).toBe('Bloxham, GB');
  // Banbury town centre.
  expect(packNearest(g, { lat: 52.0629, lon: -1.3398 })).toBe('Banbury, GB');
});

test('regions and nothing at sea', () => {
  expect(packRegion(g, { lat: 34.05, lon: -118.24 })).toEqual({ country: 'US', admin1: 'CA' });
  expect(packRegion(g, { lat: 53.7965, lon: -1.5478 }).country).toBe('GB');
  expect(packRegion(g, { lat: 0, lon: -140 })).toEqual({ country: null, admin1: null });
  expect(packNearest(g, { lat: 40, lon: -40 })).toBeNull();
});

test('finding a place by name picks the biggest', () => {
  expect(packFind(g, 'Paris')).toMatchObject({ name: 'Paris', country: 'FR' });
  expect(packFind(g, 'banbury')).toMatchObject({ name: 'Banbury', country: 'GB' });
  expect(packFind(g, 'Zürich')).toMatchObject({ country: 'CH' });
  expect(packFind(g, 'xx')).toBeNull();
  expect(packFind(g, 'Nowhereville Qqq')).toBeNull();
});

test('a pack read from an unaligned buffer still works', () => {
  const shifted = new Uint8Array(bytes.length + 1);
  shifted.set(bytes, 1);
  expect(packNearest(parseGeoPack(shifted.subarray(1)), { lat: 53.7965, lon: -1.5478 })).toBe(
    'Leeds, GB',
  );
});

test('utf8 decoding', () => {
  expect(
    utf8(new Uint8Array([0x5a, 0xc3, 0xbc, 0x72, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80])),
  ).toBe('Zür€😀');
  expect(() => parseGeoPack(new Uint8Array(64))).toThrow();
});

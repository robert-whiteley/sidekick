import { answerLocation } from '@/engine/location';
import { _resetLocationTrack, noteFix, onPlaceChange } from '@/engine/location-track';

const mockFixes: {
  at: number;
  lat: number;
  lon: number;
  accM: number | null;
  speedMs?: number | null;
  source?: string;
}[] = [];
const mockPlaces: { id: number; name: string; lat: number; lon: number; radiusM: number }[] = [];
const mockSettings = {
  locationMemory: true,
  offTheRecord: false,
  webLookup: false,
  retentionDays: 0,
};
let mockHere: { lat: number; lon: number; accuracyM: number; at: number } | null = null;

jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    hasLocationPermission: () => true,
    lastLocation: () => mockHere,
    kvGet: () => null,
    kvSet: () => {},
  },
}));
jest.mock('@/engine/settings', () => ({ getSettings: () => mockSettings }));
jest.mock('@/engine/hands-free', () => ({ carConnected: () => false }));
jest.mock('@/engine/places', () => ({
  askLocationPermission: async () => true,
  currentRegion: () => ({ country: 'GB', admin1: null }),
  placeName: () => 'Leeds, GB',
}));
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
}));
jest.mock('@/memory/places-store', () => ({
  addFix: async (f: (typeof mockFixes)[number]) => {
    mockFixes.push(f);
    return true;
  },
  fixesBetween: async (from: number, to: number) =>
    mockFixes.filter((f) => f.at >= from && f.at < to).sort((a, b) => a.at - b.at),
  namedPlaces: async () => [...mockPlaces],
  namePlace: async (name: string, p: { lat: number; lon: number }) => {
    const x = { id: mockPlaces.length + 1, name, lat: p.lat, lon: p.lon, radiusM: 120 };
    mockPlaces.push(x);
    return x;
  },
  deletePlace: async (id: number) => {
    mockPlaces.splice(
      mockPlaces.findIndex((p) => p.id === id),
      1,
    );
  },
  pruneTrack: async () => {},
}));

const gym = { lat: 53.81, lon: -1.53 };
const now = new Date(2026, 10, 26, 16, 30);
const t0 = new Date(2026, 10, 26, 0, 0).getTime();

beforeEach(() => {
  mockFixes.length = 0;
  mockPlaces.length = 0;
  _resetLocationTrack();
  mockSettings.locationMemory = true;
  mockSettings.webLookup = false;
  mockHere = { ...gym, accuracyM: 15, at: Date.now() };
});

it('names a place and answers where am I', async () => {
  expect((await answerLocation('call this place the gym', { now }))?.text).toMatch(
    /Saved this spot as the gym/,
  );
  expect((await answerLocation('where am I?', { now }))?.text).toBe("You're at the gym (Leeds).");
});

it('will not save places off the record', async () => {
  expect((await answerLocation('this is home', { now, offRecord: true }))?.text).toMatch(
    /off the record/,
  );
  expect(mockPlaces).toEqual([]);
});

it('when was I last at a named place, and how long', async () => {
  mockPlaces.push({ id: 1, name: 'the gym', ...gym, radiusM: 120 });
  for (let t = 9 * 3600e3; t <= 10 * 3600e3; t += 15 * 60e3)
    mockFixes.push({ at: t0 + t, ...gym, accM: 10 });
  const last = await answerLocation('when was I last at the gym?', { now });
  expect(last?.text).toBe('You were last at the gym today at 09:00, for 1 h 20 min.');
  const long = await answerLocation('how long was I at the gym today?', { now });
  expect(long?.text).toBe('About 1 h 20 min at the gym today.');
});

it('unknown place names fall through to memory search', async () => {
  expect(await answerLocation('when was I last at zzqx?', { now })).toBeNull();
});

it('where did I park', async () => {
  const car = { lat: 53.8, lon: -1.53 };
  mockFixes.push({ at: t0 + 14 * 3600e3, ...car, accM: 10, source: 'parked' });
  const r = await answerLocation('where did I park?', { now });
  expect(r?.text).toMatch(
    /^Your car is about 1\.1 km south of here, in Leeds \(parked today at 14:00\)\.$/,
  );
});

it('where was I at a time without data', async () => {
  const r = await answerLocation('where was I at 3am?', { now });
  expect(r?.text).toMatch(/I don't know/);
  // Marked empty: the memory notes get a chance to answer first (assistant.ts).
  expect(r?.empty).toBe(true);
  expect((await answerLocation('where am I?', { now }))?.empty).toBeUndefined();
});

it('weather needs online lookup', async () => {
  expect((await answerLocation('will it rain today?', { now }))?.text).toMatch(/Online lookup/);
});

it('location memory off: history questions say so, where am I still works', async () => {
  mockSettings.locationMemory = false;
  expect((await answerLocation('where did I park', { now }))?.text).toMatch(
    /Location memory is off/,
  );
  expect((await answerLocation('where am I', { now }))?.text).toMatch(/You're in Leeds/);
});

it('reports entering and leaving named places', async () => {
  mockPlaces.push({ id: 1, name: 'the gym', ...gym, radiusM: 120 });
  const seen: string[] = [];
  onPlaceChange((e) => seen.push(`${e.type}:${e.place.name}`));
  await noteFix({ at: 1, ...gym });
  await noteFix({ at: 2, lat: 53.9, lon: -1.5 });
  expect(seen).toEqual(['enter:the gym', 'leave:the gym']);
});

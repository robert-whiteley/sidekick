import {
  addSample,
  dailyRate,
  EMPTY_USAGE,
  forecast,
  type MediaFile,
  planCleanup,
  recommendedKeep,
  recommendedReserve,
  spaceNeeded,
} from '@/engine/storage';

const GB = 1e9;
const DAY = 86_400_000;
const H = 3_600_000;

test('reserve is the larger of 2 GB and 10%', () => {
  expect(recommendedReserve(16 * GB)).toBe(2 * GB);
  expect(recommendedReserve(128 * GB)).toBeCloseTo(12.8 * GB);
});

test('keep periods grow with the phone storage', () => {
  expect(recommendedKeep(64 * GB).videoKeepHours).toBe(8);
  expect(recommendedKeep(128 * GB).audioKeepDays).toBe(90);
  expect(recommendedKeep(512 * GB).videoKeepHours).toBe(72);
});

const u = (text: number, video = 0) => ({ ...EMPTY_USAGE, text, video });

test('no rate before a day of history', () => {
  expect(dailyRate([])).toBeNull();
  expect(
    dailyRate([
      { at: 0, usage: u(0) },
      { at: 3 * H, usage: u(1e6) },
    ]),
  ).toBeNull();
});

test('rate counts growth only, not cleanups, and ignores models', () => {
  const s = [
    { at: 0, usage: u(0, 0) },
    { at: DAY, usage: { ...u(10e6, 500e6), models: 4 * GB } },
    { at: 2 * DAY, usage: u(20e6, 100e6) },
  ];
  // text +20 MB, video +500 MB (the drop of 400 MB was a cleanup) over 2 days.
  expect(dailyRate(s)).toBeCloseTo(260e6);
});

test('one sample per day, oldest dropped after the window', () => {
  let s = addSample([], { at: 0, usage: u(1) });
  s = addSample(s, { at: 2 * H, usage: u(2) });
  expect(s).toHaveLength(1);
  expect(s[0].usage.text).toBe(2);
  s = addSample(s, { at: 61 * DAY, usage: u(3) });
  expect(s).toHaveLength(1);
});

test('forecast: unknown until a day of use, warns only when it will run out soon', () => {
  expect(forecast(50 * GB, 2 * GB, null)).toEqual({
    status: 'unknown',
    text: 'Forecast available after 1 day of use',
  });
  const ok = forecast(50 * GB, 2 * GB, 100e6);
  expect(ok.status).toBe('ok');
  const soon = forecast(3 * GB, 2 * GB, 100e6);
  expect(soon.status).toBe('soon');
  expect(forecast(1 * GB, 2 * GB, 100e6)).toMatchObject({ status: 'tight', shortBy: 1 * GB });
});

test('cleanup: expired video/audio always; then oldest video, then old stills; never more', () => {
  const now = 100 * DAY;
  const keep = { videoKeepHours: 24, audioKeepDays: 30, stillsKeepDays: 30 };
  const files: MediaFile[] = [
    { path: 'v-old', kind: 'video', at: now - 2 * DAY, bytes: 1 * GB },
    { path: 'v1', kind: 'video', at: now - 5 * H, bytes: 1 * GB },
    { path: 'v2', kind: 'video', at: now - 1 * H, bytes: 1 * GB },
    { path: 'a-old', kind: 'audio', at: now - 40 * DAY, bytes: 10e6 },
    { path: 'a-new', kind: 'audio', at: now - 1 * DAY, bytes: 10e6 },
    { path: 's-old', kind: 'stills', at: now - 40 * DAY, bytes: 5e6 },
    { path: 's-new', kind: 'stills', at: now - 1 * DAY, bytes: 5e6 },
  ];
  const none = planCleanup(files, 0, now, keep);
  expect(none.expired.map((f) => f.path)).toEqual(['v-old', 'a-old']);
  expect(none.forSpace).toEqual([]);
  const some = planCleanup(files, 2 * GB, now, keep);
  expect(some.forSpace.map((f) => f.path)).toEqual(['v1']);
  const all = planCleanup(files, 10 * GB, now, keep);
  expect(all.forSpace.map((f) => f.path)).toEqual(['v1', 'v2', 's-old']);
});

test('audio kept forever when its keep period is 0', () => {
  const r = planCleanup([{ path: 'a', kind: 'audio', at: 0, bytes: 1 }], 0, 1000 * DAY, {
    videoKeepHours: 1,
    audioKeepDays: 0,
    stillsKeepDays: 1,
  });
  expect(r.expired).toEqual([]);
});

test('archives need room to unpack', () => {
  expect(spaceNeeded([{ bytes: 100 }, { bytes: 100, unpackedCheck: 'x' }])).toBe(350);
});

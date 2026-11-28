import { afterSystemDownload, Eta, formatTimeLeft, waitsForNetwork } from '@/engine/downloads';

jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));

test('a finished system download goes straight to the checksum', () => {
  expect(afterSystemDownload('done', 0)).toBe('verify');
});

test('a failed one is resumed a few times, then reported', () => {
  expect(afterSystemDownload('failed', 0)).toBe('resume');
  expect(afterSystemDownload('failed', 2)).toBe('resume');
  expect(afterSystemDownload('failed', 3)).toBe('fail');
});

test('only a download held for a network says it waits, not one queued behind the others', () => {
  expect(waitsForNetwork('paused', 3)).toBe(true); // queued for Wi-Fi
  expect(waitsForNetwork('paused', 2)).toBe(true); // no network
  expect(waitsForNetwork('pending', 0)).toBe(false); // queued behind other files, on Wi-Fi
  expect(waitsForNetwork('paused', 1)).toBe(false); // about to retry
  expect(waitsForNetwork('running', 0)).toBe(false);
});

describe('time left', () => {
  test('unknown until the speed is known, then smoothed', () => {
    const e = new Eta();
    expect(e.update(0, 1000e6, 0)).toBeNull();
    // 10 MB/s for 1 s: 990 MB left -> 99 s.
    expect(e.update(10e6, 1000e6, 1000)).toBeCloseTo(99);
  });

  test.each([
    [null, 'Working out time left…'],
    [30, 'Less than a minute left'],
    [60, 'About 1 minute left'],
    [600, 'About 10 minutes left'],
    [5400, 'About 1 h 30 min left'],
  ])('%s s -> %s', (s, text) => expect(formatTimeLeft(s)).toBe(text));
});

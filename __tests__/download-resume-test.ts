import { afterSystemDownload, Eta, formatTimeLeft } from '@/engine/downloads';

jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));

test('a finished system download goes straight to the checksum', () => {
  expect(afterSystemDownload('done', 0)).toBe('verify');
});

test('a failed one is resumed a few times, then reported', () => {
  expect(afterSystemDownload('failed', 0)).toBe('resume');
  expect(afterSystemDownload('failed', 2)).toBe('resume');
  expect(afterSystemDownload('failed', 3)).toBe('fail');
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

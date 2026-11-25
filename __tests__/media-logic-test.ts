import {
  awayFromMoment,
  cleanAlbum,
  fractionOf,
  nearestIndex,
  spotAt,
  spotAtFraction,
  step,
  suggestFolder,
  timeOf,
  totalMs,
} from '@/features/media/media-logic';

// Two 60 s segments with a 10-minute gap between them (camera off).
const segs = [
  { path: 'a.mp4', startMs: 0, endMs: 60_000 },
  { path: 'b.mp4', startMs: 660_000, endMs: 720_000 },
];

test('the moment maps to a segment and seconds into it; gaps snap forward', () => {
  expect(totalMs(segs)).toBe(120_000);
  expect(spotAt(segs, 30_000)).toEqual({ index: 0, offsetSec: 30 });
  expect(spotAt(segs, 300_000)).toEqual({ index: 1, offsetSec: 0 });
  expect(spotAt(segs, 999_999)).toEqual({ index: 1, offsetSec: 60 });
  expect(spotAt([], 1)).toBeNull();
  expect(timeOf(segs, { index: 1, offsetSec: 5 })).toBe(665_000);
});

test('scrub bar covers the stored timeline without the gap', () => {
  expect(fractionOf(segs, { index: 1, offsetSec: 0 })).toBe(0.5);
  expect(spotAtFraction(segs, 0.75)).toEqual({ index: 1, offsetSec: 30 });
  expect(spotAtFraction(segs, 1)).toEqual({ index: 1, offsetSec: 60 });
  expect(spotAtFraction(segs, -1)).toEqual({ index: 0, offsetSec: 0 });
});

test('±5 s taps cross segment boundaries and clamp at the ends', () => {
  expect(step(segs, { index: 0, offsetSec: 58 }, 5)).toEqual({ index: 1, offsetSec: 3 });
  expect(step(segs, { index: 1, offsetSec: 2 }, -5)).toEqual({ index: 0, offsetSec: 57 });
  expect(step(segs, { index: 0, offsetSec: 1 }, -5)).toEqual({ index: 0, offsetSec: 0 });
  expect(awayFromMoment(segs, { index: 0, offsetSec: 30 }, 31_000)).toBe(false);
  expect(awayFromMoment(segs, { index: 1, offsetSec: 0 }, 31_000)).toBe(true);
});

test('save folder is suggested from what was asked', () => {
  expect(suggestFolder('where did I see the red car', 'photo')).toEqual({
    album: 'Sidekick/Cars',
    label: 'Pictures/Sidekick/Cars',
  });
  expect(suggestFolder('how many trees did I see', 'video').label).toBe('Movies/Sidekick/Nature');
  expect(suggestFolder('what did the menu say', 'photo').album).toBe('Sidekick/Signs');
  expect(suggestFolder(null, 'photo').album).toBe('Sidekick');
  expect(cleanAlbum('Trip: Leeds!')).toBe('Sidekick/Trip Leeds');
  expect(cleanAlbum('Sidekick/Cars')).toBe('Sidekick/Cars');
  expect(cleanAlbum('///')).toBe('Sidekick');
});

test('photo swipe opens at the neighbour nearest the moment', () => {
  expect(nearestIndex([0, 1000, 2000, 3000], 2100)).toBe(2);
});

describe('clipLabel', () => {
  const { clipLabel } = jest.requireActual('@/features/media/media-logic');
  test('play with the length, or stop while playing', () => {
    expect(clipLabel(false, 7.4)).toBe('▶ Play 0:07');
    expect(clipLabel(false, 75)).toBe('▶ Play 1:15');
    expect(clipLabel(false, 0)).toBe('▶ Play');
    expect(clipLabel(true, 7)).toBe('■ Stop');
  });
});

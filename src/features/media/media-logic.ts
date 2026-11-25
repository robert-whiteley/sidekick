/**
 * Pure pieces of the moment player: the stored video is many short segment files; the player
 * treats them as one timeline (gaps where the camera was off are skipped). Tested.
 */

export type Segment = { path: string; startMs: number; endMs: number };

/** A spot on the timeline: which segment, and seconds into it. */
export type Spot = { index: number; offsetSec: number };

const dur = (s: Segment) => Math.max(0, s.endMs - s.startMs);

/** Total stored length in ms (segments only, gaps skipped). */
export const totalMs = (segs: Segment[]) => segs.reduce((n, s) => n + dur(s), 0);

/**
 * The spot for a wall-clock time. Inside a gap (camera was off) it snaps to the next segment's
 * start; after the last one, to the last segment's end. Null when nothing is stored.
 */
export function spotAt(segs: Segment[], atMs: number): Spot | null {
  if (!segs.length) return null;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (atMs < s.startMs) return { index: i, offsetSec: 0 };
    if (atMs < s.endMs) return { index: i, offsetSec: (atMs - s.startMs) / 1000 };
  }
  const last = segs.length - 1;
  return { index: last, offsetSec: dur(segs[last]) / 1000 };
}

/** Wall-clock time of a spot. */
export function timeOf(segs: Segment[], spot: Spot): number {
  return segs[spot.index].startMs + spot.offsetSec * 1000;
}

/** Position along the stored timeline (0–1), for the scrub bar. */
export function fractionOf(segs: Segment[], spot: Spot): number {
  const total = totalMs(segs);
  if (!total) return 0;
  let before = 0;
  for (let i = 0; i < spot.index; i++) before += dur(segs[i]);
  return Math.min(1, Math.max(0, (before + spot.offsetSec * 1000) / total));
}

/** The spot at a scrub-bar position (0–1). */
export function spotAtFraction(segs: Segment[], fraction: number): Spot | null {
  if (!segs.length) return null;
  let left = Math.min(1, Math.max(0, fraction)) * totalMs(segs);
  for (let i = 0; i < segs.length; i++) {
    const d = dur(segs[i]);
    if (left < d || i === segs.length - 1)
      return { index: i, offsetSec: Math.round(Math.min(left, d)) / 1000 };
    left -= d;
  }
  return null;
}

/** A spot moved by `deltaSec` (tap left/right = ±5 s), across segment boundaries, clamped. */
export function step(segs: Segment[], spot: Spot, deltaSec: number): Spot {
  const total = totalMs(segs);
  if (!total) return spot;
  const f = fractionOf(segs, spot) + (deltaSec * 1000) / total;
  return spotAtFraction(segs, f) ?? spot;
}

/** Far enough from the moment to show "Back to moment". */
export const awayFromMoment = (segs: Segment[], spot: Spot, momentAt: number) =>
  Math.abs(timeOf(segs, spot) - momentAt) > 3_000;

/** "12:04:31" for the time label. */
export function clock(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

const KINDS: [RegExp, string][] = [
  [
    /\b(car|cars|van|truck|lorry|bus|bike|bicycle|motorbike|vehicle|plate|registration|parking)\b/,
    'Cars',
  ],
  [/\b(dog|dogs|cat|cats|bird|birds|pet|pets|animal|animals|horse|cow|sheep)\b/, 'Animals'],
  [
    /\b(tree|trees|flower|flowers|plant|plants|park|garden|forest|beach|mountain|lake|view|sunset)\b/,
    'Nature',
  ],
  [/\b(sign|signs|menu|board|poster|label|notice|text|price)\b/, 'Signs'],
  [/\b(receipt|ticket|document|letter|form|invoice|bill)\b/, 'Documents'],
  [/\b(food|meal|dinner|lunch|breakfast|cake|coffee|drink|restaurant)\b/, 'Food'],
  [/\b(keys|wallet|phone|glasses|bag|watch|umbrella)\b/, 'Things'],
  [/\b(house|building|street|shop|station|church|bridge)\b/, 'Places'],
];

/**
 * The folder a saved moment goes to, from what the user asked about: "where did I see the red
 * car" → Pictures/Sidekick/Cars (videos: Movies/…). The album name must be letters, digits,
 * spaces or dashes with "/" between folders (the phone's media store rule).
 */
export function suggestFolder(
  topic: string | null | undefined,
  kind: 'video' | 'photo',
): { album: string; label: string } {
  const t = (topic ?? '').toLowerCase();
  const sub = KINDS.find(([re]) => re.test(t))?.[1];
  const album = sub ? `Sidekick/${sub}` : 'Sidekick';
  return { album, label: `${kind === 'video' ? 'Movies' : 'Pictures'}/${album}` };
}

/** A user-typed folder made safe for the media store ("Trip: Leeds!" → "Sidekick/Trip Leeds"). */
export function cleanAlbum(input: string): string {
  const parts = input
    .split('/')
    .map((p) => p.replace(/[^\w -]/g, '').trim())
    .filter(Boolean);
  if (!parts.length) return 'Sidekick';
  if (parts[0] !== 'Sidekick') parts.unshift('Sidekick');
  return parts.join('/');
}

/** Index of the photo shown first among neighbours (the one nearest the moment). */
export function nearestIndex(times: number[], at: number): number {
  let best = 0;
  times.forEach((t, i) => {
    if (Math.abs(t - at) < Math.abs(times[best] - at)) best = i;
  });
  return best;
}

/** The speech clip button: "▶ Play 0:07" / "■ Stop". */
export function clipLabel(playing: boolean, durationSec: number): string {
  if (playing) return '■ Stop';
  const s = Math.max(0, Math.round(durationSec || 0));
  return s ? `▶ Play ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '▶ Play';
}

/** Pure pieces of memory search; tested. */

/** Reciprocal rank fusion: merges ranked id lists (vector, keyword) into one ranking. */
export function fuseRankings(lists: number[][], k = 60): number[] {
  const score = new Map<number, number>();
  for (const list of lists) {
    list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Turns a question into a safe FTS5 query: significant words, OR-ed, prefix-matched. */
const STOP = new Set(
  'a an and are as at be but by did do does for from had has have he her his how i in is it me my of on or our she so that the their them they this to was we were what when where which who why with you your'.split(
    ' ',
  ),
);
export function ftsQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return null;
  return words.map((w) => `"${w}"*`).join(' OR ');
}

/** Time window implied by the question ("this morning", "yesterday"…), or null. */
export function timeWindow(q: string, now: Date): { from: number; to: number } | null {
  const day = (offset: number) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.getTime();
  };
  const at = (offset: number, h: number) => day(offset) + h * 3600_000;
  const s = q.toLowerCase();
  if (/\bthis morning\b/.test(s)) return { from: day(0), to: at(0, 12) };
  if (/\bthis afternoon\b/.test(s)) return { from: at(0, 12), to: at(0, 18) };
  if (/\b(this evening|tonight)\b/.test(s)) return { from: at(0, 17), to: day(1) };
  if (/\btoday\b/.test(s)) return { from: day(0), to: day(1) };
  if (/\byesterday morning\b/.test(s)) return { from: day(-1), to: at(-1, 12) };
  if (/\byesterday\b/.test(s)) return { from: day(-1), to: day(0) };
  if (/\blast night\b/.test(s)) return { from: at(-1, 17), to: at(0, 5) };
  if (/\bthis week\b/.test(s)) return { from: day(-((now.getDay() + 6) % 7)), to: day(1) };
  if (/\blast week\b/.test(s)) {
    const monday = -((now.getDay() + 6) % 7);
    return { from: day(monday - 7), to: day(monday) };
  }
  const ago = /\b(an?|\d+) (minute|hour|day)s? ago\b/.exec(s);
  if (ago) {
    const n = ago[1] === 'a' || ago[1] === 'an' ? 1 : Number(ago[1]);
    const unit = { minute: 60_000, hour: 3600_000, day: 86_400_000 }[ago[2] as 'minute'];
    const center = now.getTime() - n * unit;
    return { from: center - unit, to: center + unit };
  }
  return null;
}

/** Does the question ask about a photo/something seen (so we re-read the original image)? */
export function asksAboutSomethingSeen(q: string): boolean {
  return /\b(see|saw|seen|look|looked|sign|photo|picture|read|say on|written|label|screen|menu|board)\b/i.test(
    q,
  );
}

/**
 * Is the question about what the camera sees right now? Only then is a photo taken: a photo adds
 * ~25 s on older phones, so "what is my locker code?" must stay text-only.
 */
export function asksAboutWhatIsInView(q: string): boolean {
  return /\b(this|these|here|in front|looking at|camera|(can|do) you see|what do you see|read (it|this|that)|what('s| is) (that|it)|what am i)\b/i.test(
    q,
  );
}

/** Prompt formats EmbeddingGemma 2 was trained with. */
export const embedQuery = (q: string) => `task: search result | query: ${q}`;
export const embedDocument = (t: string) => `title: none | text: ${t}`;

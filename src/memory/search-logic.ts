/** Pure pieces of memory search; tested. */
import { parseTimeRange } from './time-range';

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

/** "5 minutes ago", "a few hours ago", "a couple of days ago". */
export const AGO = /\b(an?|\d+|(?:a )?(?:couple(?: of)?|few)|several) (minute|hour|day)s? ago\b/;

/** Time window implied by the question ("this morning", "last Tuesday", "2 hours ago"…), or null. */
export function timeWindow(q: string, now: Date): { from: number; to: number } | null {
  const r = parseTimeRange(q, now);
  return r ? { from: r.from, to: r.to } : null;
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

/**
 * Does the question only make sense with the camera looking now ("what am I looking at?", "what
 * is this?", "can you see the bus?", "watch live")? Narrower than asksAboutWhatIsInView: with no
 * photo, the iPhone opens its camera instead of asking the model. Questions about the past
 * ("what did I see this morning?") are memory questions, not this.
 */
export function wantsCameraNow(q: string): boolean {
  if (/\b(saw|seen|earlier|yesterday|ago|this morning|last|did i|was i|were)\b/i.test(q))
    return false;
  return /\b(what am i (looking at|seeing|holding)|in front of me|(can|do) you see|what do you see|look at this|watch (this|live)|live (video|stream|view)|what('s| is) (this|that)( thing)?\??$|read (this|that)\??$)/i.test(
    q.trim(),
  );
}

/** Prompt formats EmbeddingGemma 2 was trained with. */
export const embedQuery = (q: string) => `task: search result | query: ${q}`;
export const embedDocument = (t: string) => `title: none | text: ${t}`;

/** Stored vectors came from a different embedder file than the current one: re-embed them. */
export const embedderChanged = (stored: string | null, current: string) => stored !== current;

/**
 * How many photo-vector matches join the ranking. Every photo is "nearest" to some question, so
 * only the top few count; inside a time window all candidates are kept (the window filters them).
 */
export const imageHits = (hasTimeWindow: boolean) => (hasTimeWindow ? 200 : 3);

/** Photos embedded per catch-up call: each takes ~1 s on an older phone, and a question waits. */
export const PHOTO_EMBED_BATCH = 8;

/**
 * The known name (a place like "Leeds, GB" or a person like "Sam") the question is about, matched
 * on whole words of its first part, longest name first. Null if none is mentioned.
 */
export function mentionedName(question: string, names: string[]): string | null {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9' ]/g, ' ')} `;
  const byLength = [...new Set(names)]
    .map((n) => ({ n, key: n.split(',')[0].trim().toLowerCase() }))
    .filter((x) => x.key.length >= 2)
    .sort((a, b) => b.key.length - a.key.length);
  return byLength.find((x) => q.includes(` ${x.key} `))?.n ?? null;
}

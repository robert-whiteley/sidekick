import { withoutTimeWords } from './recap-logic';
import { AGO } from './search-logic';

/**
 * Pure pieces of camera recall (what was seen): ranking, confidence, counting and the tool plan.
 * Tested in __tests__/recall-logic-test.ts. The DB / model side is in recall.ts and frames.ts.
 */

/** One stored frame or photo that the question's vector was compared with. */
export type Candidate = {
  id: number;
  at: number;
  /** Cosine similarity to the question (1 = same direction). */
  sim: number;
  vector?: number[];
  path?: string | null;
};

export type SortMode = 'best' | 'newest' | 'oldest';

/** What kind of recall the question needs. */
export type RecallIntent =
  /** "What am I looking at", "is that car moving": the camera's last frames, no search. */
  | 'live'
  /** "How many trees did I see": count separate sightings. */
  | 'count'
  /** "What did that sign say", "that car's number plate": look closer (OCR) at the best match. */
  | 'read'
  /** "Was the car moving", "did I pick up my keys": frames around the moment. */
  | 'movement'
  /** "Where did I leave my keys", "when did I last see Sam": the newest confident match. */
  | 'where'
  /** Anything else about what was seen. */
  | 'seen'
  /** Not about what the camera saw. */
  | 'none';

const LIVE =
  /\b(right now|in front of me|looking at|can you see|do you see|what do you see|what am i|what('s| is) (this|that|it)\b(?! i saw)|is (this|that|it)( \w+)? (moving|coming))/i;
const COUNT = /\bhow many\b|\bcount(ed)?\b|\bnumber of\b(?! ?plate)/i;
const READ =
  /\b(say|said on|says|written|read|sign|plate|registration|label|menu|board|price|text|number on|what was the (name|number))\b/i;
const MOVEMENT =
  /\b(moving|move|moved|movement|walk(ed|ing)?|going|went|came|coming|turn(ed)?|pick(ed)? up|put (it )?down|left (it|them)|drove|driving|direction|towards|away)\b/i;
const WHERE = /\b(where|last (seen|saw|time)|when did i (last )?(see|saw|have))\b/i;
const SEEN =
  /\b(see|saw|seen|look(ed)?|noticed|spotted|camera|photo|picture|frame|video|clip|show me)\b/i;

/** Classifies a question; "none" means the camera memory isn't needed (fast path). */
export function recallIntent(question: string): RecallIntent {
  const q = question.trim();
  if (LIVE.test(q) && !/\b(saw|seen|earlier|yesterday|ago|this morning|last)\b/i.test(q))
    return 'live';
  const seen = SEEN.test(q);
  if (COUNT.test(q) && seen) return 'count';
  if (READ.test(q) && (seen || /\b(that|the) (sign|plate|label|menu|board)\b/i.test(q)))
    return 'read';
  if (
    WHERE.test(q) &&
    (seen || /\b(keys|wallet|phone|glasses|car|bag|parked|leave|left)\b/i.test(q))
  )
    return 'where';
  if (MOVEMENT.test(q) && seen) return 'movement';
  return seen ? 'seen' : 'none';
}

/** Sort used when the user hasn't picked one: "where / last seen" → newest, else best match. */
export function defaultSort(intent: RecallIntent, question = ''): SortMode {
  if (/\b(first time|earliest|first (saw|see|seen))\b/i.test(question)) return 'oldest';
  return intent === 'where' ? 'newest' : 'best';
}

/**
 * Similarities of the closest few hundred stored items to a question: the gate is measured on
 * these, not fixed, because EmbeddingGemma's text-to-image similarities sit in a narrow band
 * (~0.05–0.35) that moves with the question. A match must stand out from the crowd (above
 * median + 3 robust deviations), be near the best one, and clear an absolute floor.
 */
export const SIM_FLOOR = 0.12;
export const NEAR_TOP = 0.06;
export function confidenceThreshold(sims: number[]): number {
  if (!sims.length) return Infinity;
  const s = [...sims].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const dev = [...s.map((x) => Math.abs(x - med))].sort((a, b) => a - b);
  const mad = dev[Math.floor(dev.length / 2)] || 0.01;
  return Math.max(SIM_FLOOR, med + 3 * 1.4826 * mad);
}

/** Only confident matches: above the measured threshold and within NEAR_TOP of the best. */
export function confidentMatches<T extends Candidate>(cands: T[], allSims?: number[]): T[] {
  if (!cands.length) return [];
  const threshold = confidenceThreshold(allSims ?? cands.map((c) => c.sim));
  const top = Math.max(...cands.map((c) => c.sim));
  return cands.filter((c) => c.sim >= threshold && c.sim >= top - NEAR_TOP);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Maximal marginal relevance: the best match first, then the ones most relevant AND least like
 * those already picked (so five frames of the same suncream bottle don't crowd out the beach).
 * Without vectors, frames close in time count as alike.
 */
export function mmr<T extends Candidate>(cands: T[], k: number, lambda = 0.7): T[] {
  const left = [...cands].sort((a, b) => b.sim - a.sim);
  const picked: T[] = [];
  const alike = (a: T, b: T) =>
    a.vector && b.vector ? cosine(a.vector, b.vector) : Math.abs(a.at - b.at) < 10_000 ? 1 : 0;
  while (picked.length < k && left.length) {
    let best = 0;
    let bestScore = -Infinity;
    left.forEach((c, i) => {
      const redundancy = picked.length ? Math.max(...picked.map((p) => alike(c, p))) : 0;
      const score = lambda * c.sim - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    picked.push(left.splice(best, 1)[0]);
  }
  return picked;
}

/** Orders matches by the chosen sort; "best" uses MMR for variety. */
export function rank<T extends Candidate>(cands: T[], sort: SortMode, k: number): T[] {
  if (sort === 'newest') return [...cands].sort((a, b) => b.at - a.at).slice(0, k);
  if (sort === 'oldest') return [...cands].sort((a, b) => a.at - b.at).slice(0, k);
  return mmr(cands, k);
}

/** Frames this close in time are the same sighting (walking past one tree takes a few seconds). */
export const SIGHTING_GAP_MS = 8_000;

/**
 * Separate sightings among matching frames: frames within SIGHTING_GAP_MS of the previous match
 * are the same thing seen again. Returns one representative (the best match) per sighting, in
 * time order.
 */
export function sightings<T extends Candidate>(matches: T[], gapMs = SIGHTING_GAP_MS): T[] {
  const byTime = [...matches].sort((a, b) => a.at - b.at);
  const out: T[] = [];
  let groupEnd = -Infinity;
  for (const m of byTime) {
    if (m.at - groupEnd > gapMs || !out.length) out.push(m);
    else if (m.sim > out[out.length - 1].sim) out[out.length - 1] = m;
    groupEnd = m.at;
  }
  return out;
}

/**
 * Times of `n` frames centred on a moment, `spacingMs` apart (oldest first): e.g. 3 frames 1 s
 * apart for "was it moving".
 */
export function aroundTimes(at: number, n: number, spacingMs: number): number[] {
  const first = at - Math.floor((n - 1) / 2) * spacingMs;
  return Array.from({ length: n }, (_, i) => first + i * spacingMs);
}

/** Up to `n` items spread evenly through a list (for "what did I see this morning"). */
export function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  if (n <= 1) return items.slice(0, n);
  const step = (items.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => items[Math.round(i * step)]);
}

/** The tool steps a question runs, in order (bounded: at most MAX_HOPS). */
export type RecallStep = 'live' | 'search' | 'browse' | 'around' | 'closer' | 'verify' | 'count';
export const MAX_HOPS = 5;
export function recallPlan(intent: RecallIntent, hasTimeWindow: boolean): RecallStep[] {
  const plan: RecallStep[] = (() => {
    switch (intent) {
      case 'none':
        return [];
      case 'live':
        return ['live'];
      case 'count':
        return ['search', 'count', 'verify'];
      case 'read':
        return ['search', 'verify', 'closer'];
      case 'movement':
        return ['search', 'verify', 'around'];
      case 'where':
        return ['search', 'verify'];
      default:
        return hasTimeWindow ? ['search', 'browse', 'verify'] : ['search', 'verify'];
    }
  })();
  return plan.slice(0, MAX_HOPS);
}

/**
 * Gemma looking at a match only pays when the search was unsure: the best match is close to the
 * threshold, or the runner-up is about as good (which one is it?).
 */
export function needsVerify(ranked: Candidate[], threshold: number): boolean {
  if (!ranked.length) return false;
  const sims = ranked.map((c) => c.sim).sort((a, b) => b - a);
  return sims[0] - threshold < 0.04 || (sims.length > 1 && sims[0] - sims[1] < 0.015);
}

/** Parses Gemma's one-word check ("yes" / "no"); anything unclear keeps the match. */
export function verifyKeeps(reply: string): boolean {
  return !/^\W*no\b/i.test(reply.trim());
}

/** The words of the question naming what to look for ("red car" from "where did I see a red car"); empty for a pure time question ("what did I see 5 minutes ago"). */
export function lookFor(question: string): string {
  return withoutTimeWords(question.toLowerCase().replace(/[?!.]/g, ''))
    .replace(new RegExp(AGO.source, 'g'), ' ')
    .replace(
      /\b(how many|did i|do i|have i|i|you|me|my|see|saw|seen|look(ed)?|at|when|where|what|was|were|the|a|an|is|it|that|last|time|today|yesterday|this|morning|afternoon|evening|earlier|show|say|said|on|of|there|any|number)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const hhmm = (at: number) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** A time-only question ("what did I see 5 minutes ago?") asked about the frame itself. */
export function imageQuestion(at: number): string {
  return `What does the attached image show? It is what my camera saw at ${hhmm(at)}. Answer as "You saw …".`;
}

/** The camera part of the prompt: short, factual, with times (each prompt token delays the answer). */
export function recallPrompt(
  intent: RecallIntent,
  found: { at: number; text?: string }[],
  extra: { count?: number; frames?: number; read?: string | null; what?: string },
): string {
  if (intent === 'live')
    return extra.frames
      ? `Camera now: the last ${extra.frames} frame${extra.frames > 1 ? 's' : ''}, about 1 s apart, oldest first.\n`
      : '';
  if (!found.length)
    return intent === 'none'
      ? ''
      : 'Camera memory: nothing seen matches this confidently. Say so; do not guess.\n';
  const lines: string[] = [];
  if (intent === 'count' && extra.count != null)
    lines.push(
      `Camera memory: ${extra.count} separate sighting${extra.count === 1 ? '' : 's'} of ${extra.what ?? 'it'} (frames within a few seconds count once). Check the images; answer with the count.`,
    );
  else
    lines.push(
      `Camera memory: the attached image is what the camera saw at ${hhmm(found[0].at)}${
        found.length > 1
          ? ` (other matches: ${found
              .slice(1)
              .map((f) => hhmm(f.at))
              .join(', ')})`
          : ''
      }. Answer from it: say what it shows.`,
    );
  if (extra.frames && extra.frames > 1)
    lines.push(
      `Images: ${extra.frames} frames around ${hhmm(found[0].at)}, ~1 s apart, oldest first.`,
    );
  if (extra.read) lines.push(`Text read in that frame: "${extra.read}".`);
  for (const f of found) if (f.text) lines.push(`- ${hhmm(f.at)}: ${f.text}`);
  return `${lines.join('\n')}\n`;
}

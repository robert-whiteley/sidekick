/**
 * Camera watches ("tell me when you see a parking space / my bus"): each new live-camera frame's
 * vector is compared with the watched words' text vector (EmbeddingGemma 2 puts both in one
 * space). A hit must stand out from what this watch has seen so far (the same robust gate as
 * recall: median + 3 deviations, with a floor), then is confirmed by Gemma looking at the frame
 * when the phone is fast enough. One alert per sighting: not again within 8 s, nor for the same
 * scene. No running narration. Pure; tested in __tests__/focus-logic-test.ts.
 */

import { confidenceThreshold, cosine, SIGHTING_GAP_MS } from '@/memory/recall-logic';

export type Watch = {
  id: string;
  /** What to look for, as said ("parking space", "red bus"). */
  what: string;
  /** "Whenever you see…": keeps watching after a sighting; else it ends at the first. */
  every: boolean;
  createdAt: number;
  expiresAt: number;
  /** The words' vector (null until the embedder ran). */
  vector: number[] | null;
  /** Recent similarities, for the gate (newest last). */
  sims: number[];
  lastAlertAt: number | null;
  /** The frame vector of the last alert: the same scene isn't announced twice. */
  lastAlertVec: number[] | null;
};

/** Default life of a watch. */
export const WATCH_MS = 2 * 60 * 60_000;
export const MAX_WATCHES = 5;
/** Similarities kept per watch for the gate. */
export const WINDOW = 120;
/** Frames needed before the robust gate is trusted; until then only a strong match counts. */
export const WARMUP = 10;
/** EmbeddingGemma text→image similarities sit around 0.05–0.35; these are within that band. */
export const STRONG_SIM = 0.24;
export const ABS_FLOOR = 0.14;
/** Same scene as the last alert: frame vectors this close. */
export const SAME_SCENE = 0.92;
/** …unless this long has passed (the bus came back round). */
export const SCENE_RESET_MS = 10 * 60_000;
/** Phones writing at least this fast confirm a hit with Gemma before saying it. */
export const CONFIRM_TOK_PER_SEC = 10;

export function newWatch(what: string, every: boolean, now: number, id = `w${now}`): Watch {
  return {
    id,
    what,
    every,
    createdAt: now,
    expiresAt: now + WATCH_MS,
    vector: null,
    sims: [],
    lastAlertAt: null,
    lastAlertVec: null,
  };
}

export type FrameVerdict = 'none' | 'hit' | 'strong';

/**
 * Scores one frame for [w] (mutates its similarity window). 'hit': stands out, worth a check;
 * 'strong': also clearly above the gate (said even without a check).
 */
export function scoreFrame(w: Watch, frame: number[], at: number): FrameVerdict {
  if (!w.vector || at > w.expiresAt) return 'none';
  const sim = cosine(w.vector, frame);
  const gate =
    w.sims.length >= WARMUP ? Math.max(ABS_FLOOR, confidenceThreshold(w.sims)) : STRONG_SIM;
  w.sims.push(sim);
  if (w.sims.length > WINDOW) w.sims.splice(0, w.sims.length - WINDOW);
  if (sim < gate) return 'none';
  if (w.lastAlertAt != null && at - w.lastAlertAt < SIGHTING_GAP_MS) return 'none';
  if (
    w.lastAlertVec &&
    w.lastAlertAt != null &&
    at - w.lastAlertAt < SCENE_RESET_MS &&
    cosine(w.lastAlertVec, frame) >= SAME_SCENE
  )
    return 'none';
  return sim >= Math.max(STRONG_SIM, gate + 0.04) ? 'strong' : 'hit';
}

/** Records a said sighting; returns false when the watch is now finished. */
export function noteAlert(w: Watch, frame: number[], at: number): boolean {
  w.lastAlertAt = at;
  w.lastAlertVec = frame;
  return w.every;
}

/** What is said for a sighting. */
export function alertText(what: string, confirmed: boolean): string {
  return confirmed ? `I can see ${what} now.` : `I think I can see ${what}.`;
}

/** Watches still running at [now]. */
export const liveWatches = (ws: Watch[], now: number) => ws.filter((w) => w.expiresAt > now);

/** The watches "stop watching for X" means (all when [what] is null). */
export function matchWatches(ws: Watch[], what: string | null): Watch[] {
  if (!what) return ws;
  const words = what
    .toLowerCase()
    .split(/\s+/)
    .filter((x) => x.length > 2);
  return ws.filter((w) => {
    const t = w.what.toLowerCase();
    return t === what.toLowerCase() || words.some((x) => t.includes(x));
  });
}

/** "a parking space and the red bus" for a list. */
export function listWatches(ws: Watch[]): string {
  const names = ws.map((w) => w.what);
  if (!names.length) return "I'm not watching for anything.";
  const joined =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `I'm watching for ${joined}.`;
}

/**
 * A person named by name ("tell me when you see Sam") can't be found by looking: Sidekick does
 * not recognise faces. True for a capitalised single name in the original words.
 */
export function looksLikeName(originalWords: string): boolean {
  const w = originalWords.trim().replace(/^(my |the |a |an )/i, '');
  return /^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/.test(w) && !/^(Bus|Car|Taxi|Train|Tram|Uber)$/.test(w);
}

import SidekickNative from '../../modules/sidekick-native';
import { isDownloaded, modelPath } from '@/engine/downloads';
import { askLlm } from '@/engine/llm';
import { EMBEDDER_FILE } from '@/engine/models';
import { SYSTEM_PROMPT } from '@/engine/prompts';
import { getSettings } from '@/engine/settings';
import { EMBED_DIMS } from './db';
import {
  framePathsAround,
  ingestFrames,
  latestFramePaths,
  nearestSeen,
  seenBetween,
  textOfFrame,
  videoSegments,
  type FrameHit,
} from './frames';
import {
  confidenceThreshold,
  confidentMatches,
  defaultSort,
  imageQuestion,
  lookFor,
  needsVerify,
  rank,
  recallIntent,
  recallPlan,
  recallPrompt,
  sightings,
  spread,
  verifyKeeps,
  type RecallIntent,
  type SortMode,
} from './recall-logic';
import { embedQuery, timeWindow } from './search-logic';

/**
 * Camera recall: what was seen. A short tool loop run on the phone (rules pick the steps; Gemma
 * only looks at images when the search was unsure): search the frames by meaning, browse a time
 * window, take frames around the moment for movement, look closer (OCR) for signs and plates,
 * and return the prompt part, the images for the model, and the stored moment to show.
 */

export type RecallMedia = { kind: 'video' | 'photo'; at: number; path?: string };
export type RecallRef = { id: number; at: number; path: string | null; sim: number };
export type RecallResult = {
  /** Goes into the prompt before "Question:" ('' when the camera memory isn't needed). */
  promptPart: string;
  /** Images for the model to look at, oldest first (live: the last frames). */
  images: string[];
  /** The stored moment to show in the chat (player opens here). */
  media?: RecallMedia;
  /** The confident matches, in the chosen sort (for a results list). */
  refs: RecallRef[];
  intent: RecallIntent;
  sort: SortMode;
  /** Separate sightings, for "how many" questions. */
  count?: number;
  /**
   * The question as the model should see it. "What did I see 5 minutes ago?" makes the small
   * model say it can't know the past even with the frame attached, so a time-only question
   * becomes a plain question about the image.
   */
  modelQuestion?: string;
};

/** What recall needs from the phone; swapped for fakes in tests. */
export type RecallDeps = {
  embed: (text: string) => Promise<number[] | null>;
  nearest: (qv: number[], win: { from: number; to: number } | null) => Promise<FrameHit[]>;
  between: (from: number, to: number) => Promise<FrameHit[]>;
  around: (at: number, n: number, spacingMs: number) => Promise<string[]>;
  latest: (n: number) => string[];
  readText: (id: number) => Promise<string>;
  hasVideo: (at: number) => Promise<boolean>;
  /** Gemma looks at one image: "does it show X?" → its reply. */
  look: (imagePath: string, what: string) => Promise<string>;
  frameWindow: () => number;
  now: () => Date;
};

const EMPTY = (intent: RecallIntent, sort: SortMode): RecallResult => ({
  promptPart: '',
  images: [],
  refs: [],
  intent,
  sort,
});

/** Matches shown/considered per question; the model sees at most frameWindow images. */
const TOP_K = 6;
const VERIFY_MAX = 2;

export async function recallContext(
  question: string,
  opts?: { sort?: SortMode },
  deps: RecallDeps = phoneDeps,
): Promise<RecallResult> {
  const intent = recallIntent(question);
  const sort = opts?.sort ?? defaultSort(intent, question);
  const win = timeWindow(question, deps.now());
  const plan = recallPlan(intent, !!win);
  if (!plan.length) return EMPTY(intent, sort);
  const n = Math.max(1, Math.min(6, deps.frameWindow()));

  if (plan[0] === 'live') {
    const images = deps.latest(n);
    return {
      ...EMPTY(intent, sort),
      images,
      promptPart: recallPrompt(intent, [], { frames: images.length }),
    };
  }

  await ingestFrames().catch(() => 0);
  const what = lookFor(question);
  const qv = what ? await deps.embed(what) : null;
  let hits: FrameHit[] = qv ? await deps.nearest(qv, win) : [];
  const threshold = confidenceThreshold(hits.map((h) => h.sim));
  let matches = confidentMatches(
    hits.slice(0, 60),
    hits.map((h) => h.sim),
  );

  // Browse by time: "what did I see this morning" with nothing specific matched.
  // These are picked by time, not by a match, so there is nothing for Gemma to check.
  let browsed = false;
  if (plan.includes('browse') && win && !matches.length) {
    hits = spread(await deps.between(win.from, win.to), n);
    matches = hits;
    browsed = hits.length > 0;
  }

  let ranked = rank(matches, sort, TOP_K);
  let count: number | undefined;
  if (plan.includes('count')) {
    const groups = sightings(matches);
    count = groups.length;
    ranked = rank(groups, 'best', TOP_K);
  }

  // Gemma checks the top matches by looking at them, only when the search was unsure.
  if (plan.includes('verify') && !browsed && what && needsVerify(ranked, threshold)) {
    const checked: FrameHit[] = [];
    for (const [i, m] of ranked.entries()) {
      if (i >= VERIFY_MAX || !m.path) {
        checked.push(m);
        continue;
      }
      const keep = await deps
        .look(m.path, what)
        .then(verifyKeeps)
        .catch(() => true);
      if (keep) checked.push(m);
    }
    if (count != null) count -= ranked.length - checked.length;
    ranked = checked;
  }

  if (!ranked.length)
    return { ...EMPTY(intent, sort), promptPart: recallPrompt(intent, [], {}), count };
  const top = ranked[0];

  let images = ranked.slice(0, n).flatMap((m) => (m.path ? [m.path] : []));
  // Movement: ~n frames ~1 s apart around the best moment (change over time).
  if (plan.includes('around')) {
    const frames = await deps.around(top.at, n, 1000).catch(() => []);
    if (frames.length) images = frames;
  }
  let read: string | null = null;
  if (plan.includes('closer')) {
    read = (await deps.readText(top.id).catch(() => '')).match(/Read: "([^"]+)"/)?.[1] ?? null;
    images = top.path ? [top.path] : images;
  }

  const video = await deps.hasVideo(top.at).catch(() => false);
  return {
    promptPart: recallPrompt(intent, ranked.slice(0, 3), {
      count,
      what,
      read,
      frames: plan.includes('around') ? images.length : undefined,
    }),
    images,
    media: {
      kind: video || intent === 'movement' ? 'video' : 'photo',
      at: top.at,
      path: top.path ?? undefined,
    },
    refs: ranked.map((m) => ({ id: m.id, at: m.at, path: m.path, sim: m.sim })),
    intent,
    sort,
    count,
    modelQuestion: browsed && images.length ? imageQuestion(top.at) : undefined,
  };
}

/** The results list with another sort (Best match / Newest / Oldest), no model calls. */
export async function recallResults(question: string, sort: SortMode, deps = phoneDeps) {
  return recallContext(question, { sort }, { ...deps, look: async () => 'yes' });
}

// The question vector is reused for a few seconds (assistant search embeds the same question).
let lastEmbed: { text: string; at: number; v: number[] } | null = null;

const phoneDeps: RecallDeps = {
  async embed(text) {
    if (!isDownloaded(EMBEDDER_FILE)) return null;
    if (lastEmbed && lastEmbed.text === text && Date.now() - lastEmbed.at < 30_000)
      return lastEmbed.v;
    const [v] = await SidekickNative.embed(
      modelPath(EMBEDDER_FILE),
      [embedQuery(text)],
      EMBED_DIMS,
    );
    lastEmbed = { text, at: Date.now(), v };
    return v;
  },
  nearest: (qv, win) => nearestSeen(qv, win ? 400 : 200, win),
  between: (from, to) => seenBetween(from, to),
  around: framePathsAround,
  latest: latestFramePaths,
  readText: textOfFrame,
  hasVideo: async (at) => (await videoSegments(at - 2000, at + 2000)).length > 0,
  async look(path, what) {
    const { text } = await askLlm(
      `Does this image show ${what}? Answer only yes or no.`,
      path,
      () => {},
      { system: SYSTEM_PROMPT, maxTokens: 3, scratch: true },
    );
    return text;
  },
  frameWindow: () => (getSettings() as { frameWindow?: number }).frameWindow ?? 3,
  now: () => new Date(),
};

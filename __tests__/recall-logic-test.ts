import {
  aroundTimes,
  confidenceThreshold,
  confidentMatches,
  defaultSort,
  lookFor,
  mmr,
  needsVerify,
  rank,
  recallIntent,
  recallPlan,
  recallPrompt,
  sightings,
  spread,
  verifyKeeps,
  type Candidate,
} from '@/memory/recall-logic';
import { parseFrameLine } from '@/memory/frames';
import { recallContext, type RecallDeps } from '@/memory/recall';

jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));
jest.mock('@/memory/db', () => ({ EMBED_DIMS: 4, getDb: jest.fn(), vecParam: (v: number[]) => v }));
jest.mock('@/memory/photo-ocr', () => ({ OCR_NO_TEXT: 1, OCR_PENDING: 0, readTextOf: jest.fn() }));
jest.mock('@/engine/llm', () => ({ askLlm: jest.fn() }));
jest.mock('@/engine/downloads', () => ({ isDownloaded: () => false, modelPath: () => '' }));
jest.mock('@/engine/settings', () => ({ getSettings: () => ({}) }));

const c = (id: number, sim: number, at = id * 60_000, path: string | null = `f${id}.jpg`) => ({
  id,
  sim,
  at,
  path,
  text: '',
});

test('questions are routed to the right recall steps', () => {
  expect(recallIntent('What am I looking at?')).toBe('live');
  expect(recallIntent('Is that car moving?')).toBe('live');
  expect(recallIntent('How many trees did I see this morning?')).toBe('count');
  expect(recallIntent('What did that sign say?')).toBe('read');
  expect(recallIntent("What was that car's number plate I saw?")).toBe('read');
  expect(recallIntent('Where did I leave my keys?')).toBe('where');
  expect(recallIntent('When did I last see a red car?')).toBe('where');
  expect(recallIntent('Was the dog I saw moving towards me?')).toBe('movement');
  expect(recallIntent('Did I see a red car today?')).toBe('seen');
  expect(recallIntent("What's Sam's number?")).toBe('none');
  expect(recallIntent('Remind me to call mum')).toBe('none');
  expect(recallPlan('none', false)).toEqual([]);
  expect(recallPlan('seen', true)).toEqual(['search', 'browse', 'verify']);
  expect(recallPlan('movement', false)).toContain('around');
  expect(recallPlan('read', false)).toContain('closer');
});

test('"where / last seen" sorts newest first, "first time" oldest, else best match', () => {
  expect(defaultSort('where')).toBe('newest');
  expect(defaultSort('seen', 'when did I first see the cat')).toBe('oldest');
  expect(defaultSort('seen')).toBe('best');
  const cands = [c(1, 0.3, 100), c(2, 0.2, 300), c(3, 0.25, 200)];
  expect(rank(cands, 'newest', 3).map((x) => x.id)).toEqual([2, 3, 1]);
  expect(rank(cands, 'oldest', 3).map((x) => x.id)).toEqual([1, 3, 2]);
  expect(rank(cands, 'best', 1)[0].id).toBe(1);
});

test('only matches that stand out from stored similarities are confident', () => {
  // Typical crowd of text-to-image similarities (~0.05–0.15), one real "red car" at 0.31.
  const crowd = Array.from({ length: 200 }, (_, i) => c(100 + i, 0.05 + (i % 10) * 0.01));
  const all = [c(1, 0.31), c(2, 0.29), ...crowd];
  const t = confidenceThreshold(all.map((x) => x.sim));
  expect(t).toBeGreaterThan(0.15);
  expect(t).toBeLessThan(0.29);
  expect(confidentMatches(all).map((x) => x.id)).toEqual([1, 2]);
  // Nothing stands out (no red car stored): nothing is shown, rather than the "least bad".
  expect(confidentMatches(crowd)).toEqual([]);
  // An absolute floor: a tiny memory where every similarity is low.
  expect(confidentMatches([c(1, 0.09), c(2, 0.02), c(3, 0.03)])).toEqual([]);
  // Far below the best match: dropped even if above the crowd.
  expect(confidentMatches([c(1, 0.4), c(2, 0.3), ...crowd]).map((x) => x.id)).toEqual([1]);
});

test('MMR avoids five near-identical frames of the same thing', () => {
  const same = [1, 0, 0, 0];
  const other = [0, 1, 0, 0];
  const cands: Candidate[] = [
    { id: 1, at: 0, sim: 0.3, vector: same },
    { id: 2, at: 1, sim: 0.29, vector: same },
    { id: 3, at: 2, sim: 0.28, vector: same },
    { id: 4, at: 3, sim: 0.25, vector: other },
  ];
  expect(mmr(cands, 2).map((x) => x.id)).toEqual([1, 4]);
});

test('counting: frames seconds apart are one sighting; the best frame represents it', () => {
  const s = 1000;
  const m = [
    c(1, 0.2, 0),
    c(2, 0.3, 2 * s),
    c(3, 0.25, 5 * s),
    c(4, 0.3, 60 * s),
    c(5, 0.2, 200 * s),
    c(6, 0.21, 206 * s),
  ];
  const groups = sightings(m);
  expect(groups.map((g) => g.id)).toEqual([2, 4, 6]);
  // A chain of frames each a few seconds apart is one long sighting (walking past one tree).
  expect(sightings([c(1, 0.2, 0), c(2, 0.2, 7 * s), c(3, 0.2, 14 * s)])).toHaveLength(1);
  expect(sightings([])).toEqual([]);
});

test('frames around a moment, spreads and the verify gate', () => {
  expect(aroundTimes(10_000, 3, 1000)).toEqual([9000, 10_000, 11_000]);
  expect(aroundTimes(10_000, 2, 1000)).toEqual([10_000, 11_000]);
  expect(spread([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7]);
  expect(needsVerify([c(1, 0.4), c(2, 0.2)], 0.2)).toBe(false);
  expect(needsVerify([c(1, 0.22)], 0.2)).toBe(true);
  expect(needsVerify([c(1, 0.4), c(2, 0.395)], 0.2)).toBe(true);
  expect(verifyKeeps('No.')).toBe(false);
  expect(verifyKeeps('Yes')).toBe(true);
  expect(verifyKeeps('Not sure')).toBe(true);
  expect(lookFor('Where did I see the red car?')).toBe('red car');
  expect(lookFor('How many trees did I see this morning?')).toBe('trees');
});

test('prompt part is short and says when nothing matched', () => {
  expect(recallPrompt('seen', [], {})).toMatch(/nothing seen matches/);
  expect(recallPrompt('none', [], {})).toBe('');
  expect(recallPrompt('count', [{ at: 0 }], { count: 3, what: 'trees' })).toMatch(
    /3 separate sightings of trees/,
  );
  expect(recallPrompt('live', [], { frames: 3 })).toMatch(/last 3 frames/);
});

test('journal lines: only well-formed frames with the right vector size', () => {
  const ok = JSON.stringify({
    kind: 'frame',
    at: 1,
    path: '/f.jpg',
    vector: [0, 0, 0, 1],
    ocrNeeded: true,
    stillPath: '/full.jpg',
  });
  expect(parseFrameLine(ok)).toEqual({
    kind: 'frame',
    at: 1,
    path: '/f.jpg',
    vector: [0, 0, 0, 1],
    ocrNeeded: true,
    stillPath: '/full.jpg',
  });
  expect(
    parseFrameLine(JSON.stringify({ kind: 'frame', at: 1, path: '/f.jpg', vector: [1] })),
  ).toBeNull();
  expect(parseFrameLine('{bad')).toBeNull();
  // Not embedded yet (no model loaded natively): kept, embedded later.
  expect(
    parseFrameLine(JSON.stringify({ kind: 'frame', at: 2, path: '/g.jpg', vector: null }))?.vector,
  ).toBeNull();
  expect(parseFrameLine(JSON.stringify({ kind: 'line', at: 1 }))).toBeNull();
});

const deps = (over: Partial<RecallDeps> = {}): RecallDeps => {
  const crowd = Array.from({ length: 100 }, (_, i) => c(100 + i, 0.05 + (i % 10) * 0.01, i));
  return {
    embed: async () => [1, 0, 0, 0],
    nearest: async () => [c(1, 0.32, 1000), c(2, 0.31, 3000), c(3, 0.3, 600_000), ...crowd],
    between: async () => [],
    around: async () => ['a.jpg', 'b.jpg', 'c.jpg'],
    latest: (n) => ['l1.jpg', 'l2.jpg', 'l3.jpg'].slice(-n),
    readText: async () => 'Read: "AB12 CDE"',
    hasVideo: async () => true,
    look: async () => 'yes',
    frameWindow: () => 3,
    now: () => new Date(2026, 10, 25, 15),
    ...over,
  };
};

test('recall: count, read, movement, live and the fast path', async () => {
  const count = await recallContext('How many red cars did I see?', undefined, deps());
  expect(count.count).toBe(2);
  expect(count.promptPart).toMatch(/2 separate sightings of red cars/);
  expect(count.media).toEqual({ kind: 'video', at: expect.any(Number), path: expect.any(String) });

  const read = await recallContext("What was that car's number plate I saw?", undefined, deps());
  expect(read.promptPart).toMatch(/AB12 CDE/);
  expect(read.images).toHaveLength(1);

  const move = await recallContext('Was the dog I saw moving?', undefined, deps());
  expect(move.images).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);

  const live = await recallContext(
    'What am I looking at?',
    undefined,
    deps({ frameWindow: () => 2 }),
  );
  expect(live.images).toEqual(['l2.jpg', 'l3.jpg']);

  const none = await recallContext("What's Sam's number?", undefined, deps({ embed: jest.fn() }));
  expect(none.promptPart).toBe('');
});

test('recall: Gemma rejecting an unsure match removes it; no video → photo', async () => {
  const look = jest.fn(async (p: string) => (p === 'f1.jpg' ? 'No' : 'Yes'));
  const r = await recallContext(
    'Did I see a red car?',
    undefined,
    deps({
      nearest: async () => [
        c(1, 0.2),
        c(2, 0.199),
        ...Array.from({ length: 50 }, (_, i) => c(9 + i, 0.05)),
      ],
      look,
      hasVideo: async () => false,
    }),
  );
  expect(look).toHaveBeenCalled();
  expect(r.refs.map((x) => x.id)).toEqual([2]);
  expect(r.media?.kind).toBe('photo');
});

test('lookFor drops time phrases, leaving nothing for a pure time question', () => {
  expect(lookFor('What did I see 5 minutes ago?')).toBe('');
  expect(lookFor('what did I see a few minutes ago')).toBe('');
  expect(lookFor('Where was the red car an hour ago?')).toBe('red car');
});

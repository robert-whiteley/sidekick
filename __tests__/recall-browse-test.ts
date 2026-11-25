import { recallContext, type RecallDeps } from '@/memory/recall';

jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));
jest.mock('@/engine/downloads', () => ({ isDownloaded: () => false, modelPath: () => '' }));
jest.mock('@/engine/llm', () => ({ askLlm: jest.fn() }));
jest.mock('@/engine/settings', () => ({ getSettings: () => ({}) }));
jest.mock('@/memory/db', () => ({ EMBED_DIMS: 256, getDb: jest.fn() }));
jest.mock('@/memory/frames', () => ({ ingestFrames: async () => 0 }));

const now = new Date(2026, 10, 25, 14, 9, 41);
const frame = { id: 7, at: now.getTime() - 45_000, sim: 0, path: '/f/7.jpg', text: '' };

const deps = (over: Partial<RecallDeps> = {}): RecallDeps => ({
  embed: jest.fn(async () => [1, 0]),
  nearest: async () => [],
  between: async () => [frame],
  around: async () => [],
  latest: () => [],
  readText: async () => '',
  hasVideo: async () => true,
  look: jest.fn(async () => 'No'),
  frameWindow: () => 3,
  now: () => now,
  ...over,
});

test('"what did I see a minute ago" browses that minute without a search or a check', async () => {
  const d = deps();
  const r = await recallContext('what did I see a minute ago?', undefined, d);
  expect(d.embed).not.toHaveBeenCalled();
  expect(d.look).not.toHaveBeenCalled();
  expect(r.images).toEqual(['/f/7.jpg']);
  expect(r.media).toEqual({ kind: 'video', at: frame.at, path: '/f/7.jpg' });
  expect(r.modelQuestion).toContain('my camera saw at 14:08');
});

import { orderBySaved, pickFastest, typicalMs } from '../src/engine/backend-choice';
import type { LlmCandidate, LlmStats } from '../modules/sidekick-native';

const stats = (read: number, write: number): LlmStats => ({
  ttftMs: 0,
  prefillTokens: 100,
  prefillTokensPerSec: read,
  decodeTokens: 20,
  decodeTokensPerSec: write,
  totalMs: 0,
});
const cpu: LlmCandidate = { modelPath: '/m', backend: 'cpu' };
const gpu: LlmCandidate = { modelPath: '/m', backend: 'gpu' };
const tensor: LlmCandidate = { modelPath: '/t', backend: 'tensor' };

test('Pixel 5 numbers pick CPU: GPU reads faster but writes slower', () => {
  const best = pickFastest([
    { candidate: gpu, stats: stats(147, 3.6) },
    { candidate: cpu, stats: stats(77, 5.9) },
  ]);
  expect(best?.candidate.backend).toBe('cpu');
});

test('a much faster accelerator wins', () => {
  const best = pickFastest([
    { candidate: tensor, stats: stats(1500, 30) },
    { candidate: cpu, stats: stats(77, 5.9) },
  ]);
  expect(best?.candidate.backend).toBe('tensor');
});

test('unusable stats are ignored', () => {
  expect(typicalMs(stats(0, 5))).toBe(Infinity);
  expect(pickFastest([{ candidate: gpu, stats: stats(0, 0) }])).toBeNull();
});

test('saved backend goes first, others stay as fallbacks', () => {
  expect(orderBySaved([tensor, gpu, cpu], 'cpu').map((c) => c.backend)).toEqual([
    'cpu',
    'tensor',
    'gpu',
  ]);
  expect(orderBySaved([gpu, cpu], null)).toEqual([gpu, cpu]);
});

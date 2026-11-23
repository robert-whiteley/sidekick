import { EMBED_BATCH, EMBED_MAX_WAIT_MS, shouldEmbedNow } from '../src/memory/embed-policy';

const base = { pending: 1, waitedMs: 0, charging: false, lowPowerMode: false, evictsLlm: false };

test('nothing pending, nothing to do', () => {
  expect(shouldEmbedNow({ ...base, pending: 0, charging: true })).toBe(false);
});

test('while charging, anything pending is embedded', () => {
  expect(shouldEmbedNow({ ...base, charging: true, evictsLlm: true })).toBe(true);
});

test('with RAM for both models, new memories are embedded at once', () => {
  expect(shouldEmbedNow(base)).toBe(true);
});

test('unloading the chat model on a small phone needs twice the reason', () => {
  expect(shouldEmbedNow({ ...base, pending: EMBED_BATCH, evictsLlm: true })).toBe(false);
  expect(shouldEmbedNow({ ...base, pending: EMBED_BATCH * 2, evictsLlm: true })).toBe(true);
  expect(shouldEmbedNow({ ...base, waitedMs: EMBED_MAX_WAIT_MS * 2, evictsLlm: true })).toBe(true);
});

test('low-power mode waits for the charger', () => {
  expect(shouldEmbedNow({ ...base, pending: 100, lowPowerMode: true })).toBe(false);
});

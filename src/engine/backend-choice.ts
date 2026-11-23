import type { LlmBackend, LlmCandidate, LlmStats } from '../../modules/sidekick-native';

/**
 * A typical Sidekick question: a photo (~300 tokens to read) and a short spoken answer (~60
 * tokens to write). Backends are ranked by how long this takes, so a chip that reads fast but
 * writes slowly (e.g. the Pixel 5 GPU) doesn't win on reading speed alone.
 */
export const TYPICAL_READ_TOKENS = 300;
export const TYPICAL_WRITE_TOKENS = 60;

/** Fixed calibration prompt: long enough to measure reading speed, short answer to save time. */
export const CALIBRATION_PROMPT =
  'Here is a short note. The train to Leeds leaves from platform four at 14:32. Bring the blue ' +
  'folder, the charger and the umbrella, because rain is forecast after three o clock. Call Sam ' +
  'when you arrive and check the hotel booking for Thursday and Friday night. Lunch is at the ' +
  'cafe near the station. The meeting moved to room 12 on the second floor. Remember to buy ' +
  'milk on the way home. Summarise the note in one short sentence.';
export const CALIBRATION_MAX_TOKENS = 24;

export type Measurement = { candidate: LlmCandidate; stats: LlmStats };

/** Estimated milliseconds for the typical question, or Infinity if the stats are unusable. */
export function typicalMs(s: LlmStats): number {
  if (!(s.prefillTokensPerSec > 0) || !(s.decodeTokensPerSec > 0)) return Infinity;
  return (
    (TYPICAL_READ_TOKENS / s.prefillTokensPerSec + TYPICAL_WRITE_TOKENS / s.decodeTokensPerSec) *
    1000
  );
}

/** The measured-fastest candidate, or null if none produced usable numbers. */
export function pickFastest(results: Measurement[]): Measurement | null {
  let best: Measurement | null = null;
  for (const r of results) {
    if (typicalMs(r.stats) === Infinity) continue;
    if (!best || typicalMs(r.stats) < typicalMs(best.stats)) best = r;
  }
  return best;
}

/** Puts the remembered backend first; keeps the rest as fallbacks in their original order. */
export function orderBySaved(cands: LlmCandidate[], saved: LlmBackend | null): LlmCandidate[] {
  if (!saved) return cands;
  const first = cands.filter((c) => c.backend === saved);
  return [...first, ...cands.filter((c) => c.backend !== saved)];
}

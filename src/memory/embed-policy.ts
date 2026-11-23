/** Phones with less RAM than this never hold the chat model and the embedder at once. */
export const LOW_RAM_MB = 6 * 1024;

/** New memories wait for a batch this big before the embedder is loaded on battery... */
export const EMBED_BATCH = 16;
/** ...or until the oldest has waited this long. */
export const EMBED_MAX_WAIT_MS = 15 * 60_000;

/**
 * Whether to embed pending memories now. While charging anything pending is embedded; on battery
 * with enough RAM for both models it embeds at once (search is never behind); on a low-RAM phone
 * it waits for a batch (fewer model loads). On a low-RAM phone with the chat model loaded,
 * embedding unloads the chat model, so on battery it waits for twice the batch or wait time.
 */
export function shouldEmbedNow(s: {
  pending: number;
  waitedMs: number;
  charging: boolean;
  lowPowerMode: boolean;
  evictsLlm: boolean;
}): boolean {
  if (s.pending <= 0) return false;
  if (s.charging) return true;
  if (s.lowPowerMode) return false;
  // Enough RAM to keep both models: batching would only delay search, the total work is the same.
  if (!s.evictsLlm) return true;
  const k = s.evictsLlm ? 2 : 1;
  return s.pending >= EMBED_BATCH * k || s.waitedMs >= EMBED_MAX_WAIT_MS * k;
}

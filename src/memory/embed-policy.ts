import { CAPTION_MIN_BATTERY, type CaptionFramesMode } from './photo-text';

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

/**
 * Whether slow background work on photos and camera frames (photo vectors, text reading) may run
 * now. On the charger always (unless the phone is hot); on battery only when the owner chose
 * "On battery too" for camera frames, above the battery floor and not in battery saver. Text
 * memories are never held back by this: they are cheap.
 */
export function photoWorkAllowed(s: {
  mode: CaptionFramesMode;
  charging: boolean;
  batteryLevel: number;
  lowPowerMode: boolean;
  /** Android PowerManager.THERMAL_STATUS_* (2 = moderate) */
  thermalStatus: number;
}): boolean {
  if (s.thermalStatus >= 2) return false;
  if (s.charging) return true;
  return s.mode === 'always' && !s.lowPowerMode && s.batteryLevel >= CAPTION_MIN_BATTERY;
}

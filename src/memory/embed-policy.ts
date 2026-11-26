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
  /** On a charger that can't keep up (battery falling anyway). */
  drainingOnCharger?: boolean;
}): boolean {
  if (s.thermalStatus >= 2) return false;
  if (s.charging) return !s.drainingOnCharger;
  return s.mode === 'always' && !s.lowPowerMode && s.batteryLevel >= CAPTION_MIN_BATTERY;
}

/** A battery reading: level 0..1 at a time (ms). */
export type BatterySample = { at: number; level: number; charging: boolean };

/** How far back to look when deciding whether a charger keeps up. */
export const DRAIN_WINDOW_MS = 10 * 60_000;

/**
 * True when the phone is on a charger but the battery still fell over the last few minutes (a weak
 * charger, a PC port or a wireless pad that can't keep up with heavy model work). Slow background
 * work pauses then, so plugging in never means draining.
 */
export function drainingOnCharger(samples: BatterySample[], now: number): boolean {
  const recent = samples.filter((x) => x.charging && x.level >= 0 && now - x.at <= DRAIN_WINDOW_MS);
  if (recent.length < 2) return false;
  return recent[recent.length - 1].level < recent[0].level - 0.005;
}

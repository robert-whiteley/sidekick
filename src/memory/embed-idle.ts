import SidekickNative from '../../modules/sidekick-native';
import { batteryState, chargerFallingBehind } from '@/engine/battery';
import { getSettings } from '@/engine/settings';
import { LOW_RAM_MB, photoWorkAllowed, shouldEmbedNow } from './embed-policy';
import { captionMode } from './photo-text';
import { scheduleReclaim } from './reclaim';
import { countPendingEmbeds, embedPending } from './store';

/** Once per run, when idle: space left by deletes and re-embedding in earlier runs. */
let reclaimChecked = false;

let pendingSince: number | null = null;

/**
 * Idle-time embedding: embeds new memories in batches, preferring while charging.
 * Stops between batches (at most [maxBatches] of 64) as soon as [isBusy] says a question started.
 * Returns how many were embedded.
 */
export async function embedWhenIdle(
  isBusy: () => boolean,
  maxBatches = 4,
  now = Date.now(),
): Promise<number> {
  const pending = await countPendingEmbeds();
  if (!pending) {
    pendingSince = null;
    if (!reclaimChecked) {
      reclaimChecked = true;
      scheduleReclaim(0);
    }
    return 0;
  }
  pendingSince ??= now;
  const { charging, lowPowerMode, batteryLevel } = await batteryState();
  let thermalStatus = 0;
  try {
    thermalStatus = SidekickNative.deviceState().thermalStatus;
  } catch {
    // Not available on this platform: treat as cool.
  }
  const evictsLlm =
    SidekickNative.getDeviceInfo().totalRamMb < LOW_RAM_MB && SidekickNative.llmIsLoaded();
  if (!shouldEmbedNow({ pending, waitedMs: now - pendingSince, charging, lowPowerMode, evictsLlm }))
    return 0;
  const photos = photoWorkAllowed({
    mode: captionMode(getSettings().captionFrames),
    charging,
    batteryLevel,
    lowPowerMode,
    thermalStatus,
    drainingOnCharger: chargerFallingBehind(),
  });
  let total = 0;
  for (let i = 0; i < maxBatches && !isBusy(); i++) {
    const n = await embedPending(64, { photos, isBusy });
    if (!n) break;
    total += n;
  }
  if (total >= pending) pendingSince = null;
  return total;
}

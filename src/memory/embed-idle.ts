import SidekickNative from '../../modules/sidekick-native';
import { batteryState } from '@/engine/battery';
import { LOW_RAM_MB, shouldEmbedNow } from './embed-policy';
import { countPendingEmbeds, embedPending } from './store';

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
    return 0;
  }
  pendingSince ??= now;
  const { charging, lowPowerMode } = await batteryState();
  const evictsLlm =
    SidekickNative.getDeviceInfo().totalRamMb < LOW_RAM_MB && SidekickNative.llmIsLoaded();
  if (!shouldEmbedNow({ pending, waitedMs: now - pendingSince, charging, lowPowerMode, evictsLlm }))
    return 0;
  let total = 0;
  for (let i = 0; i < maxBatches && !isBusy(); i++) {
    const n = await embedPending();
    if (!n) break;
    total += n;
  }
  if (total >= pending) pendingSince = null;
  return total;
}

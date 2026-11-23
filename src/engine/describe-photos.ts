import * as Battery from 'expo-battery';

import SidekickNative from '../../modules/sidekick-native';
import { DESCRIBE_PROMPT, parseDescription, shouldDescribeNow } from '@/memory/photo-text';
import { nextUndescribedPhoto, savePhotoDescription } from '@/memory/store';
import { askLlm, cancelLlm } from './llm';

let running: Promise<void> | null = null;
let cancelled = false;

async function batteryState() {
  try {
    const [state, level, low] = await Promise.all([
      Battery.getBatteryStateAsync(),
      Battery.getBatteryLevelAsync(),
      Battery.isLowPowerModeEnabledAsync(),
    ]);
    const charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
    return { charging, batteryLevel: level, lowPowerMode: low };
  } catch {
    return { charging: false, batteryLevel: -1, lowPowerMode: false };
  }
}

/**
 * Reads one saved photo (visible text + one-line scene) into memory, if the phone is idle, the
 * model is already loaded and the battery allows it. Never loads the model just for this.
 */
export async function describeOnePhoto(busy: boolean): Promise<boolean> {
  if (running) return false;
  const ok = shouldDescribeNow({
    llmLoaded: SidekickNative.llmIsLoaded(),
    busy,
    ...(await batteryState()),
  });
  if (!ok) return false;
  const next = await nextUndescribedPhoto();
  if (!next) return false;
  cancelled = false;
  let done = false;
  running = (async () => {
    if (!SidekickNative.fileExists(next.photoPath)) {
      await savePhotoDescription(next.id, null);
      return;
    }
    const { text } = await askLlm(DESCRIBE_PROMPT, next.photoPath, () => {}, { maxTokens: 120 });
    if (cancelled) return; // a question interrupted: try this photo again later
    await savePhotoDescription(next.id, parseDescription(text));
    console.log(`[photos] described ${next.id}`);
    done = true;
  })()
    .catch((e) => console.log(`[photos] describe failed: ${String(e)}`))
    .finally(() => {
      running = null;
    });
  await running;
  return done;
}

/** A question is coming: stop describing at once and wait until the model is free. */
export async function yieldToQuestion() {
  if (!running) return;
  cancelled = true;
  cancelLlm();
  await running;
}

export const isDescribing = () => running !== null;

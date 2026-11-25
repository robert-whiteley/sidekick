import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import {
  DESCRIBE_PROMPT,
  FRAME_PROMPT,
  captionMode,
  frameCaptionPlan,
  parseDescription,
  shouldDescribeNow,
} from '@/memory/photo-text';
import { nextUncaptionedFrame, nextUndescribedPhoto, savePhotoDescription } from '@/memory/store';
import { batteryState } from './battery';
import { askLlmInBackground, cancelLlm, ensureLlm } from './llm';
import { getSettings } from './settings';

let running: Promise<void> | null = null;
let cancelled = false;

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
    const { text } = await askLlmInBackground(DESCRIBE_PROMPT, next.photoPath, { maxTokens: 120 });
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

let lastActiveAt = Date.now();
let captionsThisCharge = 0;
let lastCharging: boolean | null = null;

/** The owner opened the app or asked something: frame captions wait a little. */
export function noteUserActive() {
  lastActiveAt = Date.now();
}

/**
 * Captions one stored camera frame (objects, counts, text, movement) while the phone charges and
 * nobody is using Sidekick; the caption is saved with the frame and embedded, so recall finds it.
 * Stops on unplugging (checked before each frame), on a question (yieldToQuestion) and after a
 * cap per charge. Loads the model only on phones that can hold it beside the embedder.
 */
export async function captionOneFrame(busy: boolean): Promise<boolean> {
  if (running || Platform.OS !== 'android') return false;
  const battery = await batteryState();
  // The cap counts per charge, or per spell on battery: it resets when the charger state changes.
  if (battery.charging !== lastCharging) captionsThisCharge = 0;
  lastCharging = battery.charging;
  const device = SidekickNative.deviceState();
  const plan = frameCaptionPlan({
    mode: captionMode(getSettings().captionFrames),
    charging: battery.charging,
    batteryLevel: battery.batteryLevel,
    lowPowerMode: battery.lowPowerMode,
    busy,
    sinceActiveMs: Date.now() - lastActiveAt,
    doneThisCharge: captionsThisCharge,
    llmLoaded: SidekickNative.llmIsLoaded(),
    ramMb: SidekickNative.getDeviceInfo().totalRamMb,
    lowMemory: device.lowMemory,
    thermalStatus: device.thermalStatus,
  });
  if (plan === 'skip') return false;
  const next = await nextUncaptionedFrame();
  if (!next) return false;
  cancelled = false;
  let done = false;
  running = (async () => {
    if (!SidekickNative.fileExists(next.photoPath)) {
      await savePhotoDescription(next.id, null);
      return;
    }
    if (plan === 'load') await ensureLlm();
    if (cancelled) return;
    const { text } = await askLlmInBackground(FRAME_PROMPT, next.photoPath, { maxTokens: 160 });
    if (cancelled) return; // a question interrupted: caption this frame again later
    await savePhotoDescription(next.id, parseDescription(text));
    captionsThisCharge++;
    console.log(`[frames] captioned ${next.id}`);
    done = true;
  })()
    .catch((e) => console.log(`[frames] caption failed: ${String(e)}`))
    .finally(() => {
      running = null;
    });
  await running;
  return done;
}

/** A question is coming: stop describing at once and wait until the model is free. */
export async function yieldToQuestion() {
  noteUserActive();
  if (!running) return;
  cancelled = true;
  cancelLlm();
  await running;
}

export const isDescribing = () => running !== null;

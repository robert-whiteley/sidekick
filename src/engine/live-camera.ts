import { AppState, Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { cameraConfigFor, cameraNotice, cameraStartTook } from './camera-logic';
import { currentTuning } from './device-profile';
import { isDownloaded, modelPath } from './downloads';
import { EMBEDDER_FILE, OCR_FILES } from './models';
import { notices } from './notices';
import { getSettings, onSettingsChange } from './settings';
import { EMBED_DIMS } from '@/memory/db';
import { ingestFrames } from '@/memory/frames';

/**
 * Live camera memory: the native recorder (in the listening service) samples frames, embeds
 * them and keeps rolling video, also with the app closed. Here: start/stop, settings, holding
 * frame work while an answer runs, moving frames into memory, and notices for its events.
 */

const android = Platform.OS === 'android';
const INGEST_MS = 30_000;

let ingestTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(live: boolean) => void>();

export function liveCameraOn(): boolean {
  if (!android) return false;
  try {
    return SidekickNative.cameraStatus().running;
  } catch {
    return false;
  }
}

/** Camera watches need frames within seconds, not every 30 s (see focus-watch.ts). */
const FAST_INGEST_MS = 2_000;
let fast = false;
let ingestEvery = 0;

/** Drains frames every 2 s while a camera watch runs, else every 30 s. */
export function setFastIngest(on: boolean) {
  fast = on;
  if (ingestTimer) {
    clearInterval(ingestTimer);
    ingestTimer = null;
    setIngest(true);
  }
}

function setIngest(on: boolean) {
  const every = fast ? FAST_INGEST_MS : INGEST_MS;
  if (on && ingestTimer && ingestEvery !== every) {
    clearInterval(ingestTimer);
    ingestTimer = null;
  }
  if (on && !ingestTimer) {
    ingestEvery = every;
    ingestTimer = setInterval(() => void ingestFrames().catch(() => 0), every);
  }
  if (!on && ingestTimer) {
    clearInterval(ingestTimer);
    ingestTimer = null;
    void ingestFrames().catch(() => 0);
  }
}

/** The recorder's settings plus the on-phone models it embeds and reads text with. */
function config() {
  const ocr =
    isDownloaded(OCR_FILES.det) && isDownloaded(OCR_FILES.rec) && isDownloaded(OCR_FILES.dict);
  return {
    ...cameraConfigFor(currentTuning(), getSettings().cameraWhileLocked !== false),
    embedModelPath: isDownloaded(EMBEDDER_FILE) ? modelPath(EMBEDDER_FILE) : null,
    dims: EMBED_DIMS,
    ocrDetPath: ocr ? modelPath(OCR_FILES.det) : null,
    ocrRecPath: ocr ? modelPath(OCR_FILES.rec) : null,
    ocrDictPath: ocr ? modelPath(OCR_FILES.dict) : null,
  };
}

/** Starts live camera memory. Needs the camera permission already granted; false if it can't. */
export function startLiveCamera(): boolean {
  if (!android) return false;
  try {
    const accepted = SidekickNative.cameraStart(config());
    let running = false;
    try {
      running = SidekickNative.cameraStatus().running;
    } catch {
      // Status unavailable: trust the start.
    }
    const ok = cameraStartTook(accepted, running, AppState.currentState === 'active');
    setIngest(ok);
    listeners.forEach((l) => l(ok));
    return ok;
  } catch (e) {
    console.log(`[camera] start failed: ${String(e)}`);
    return false;
  }
}

export function stopLiveCamera() {
  if (!android) return;
  try {
    SidekickNative.cameraStop();
  } catch {
    // Not running.
  }
  setIngest(false);
  listeners.forEach((l) => l(false));
}

/** Pause / resume filming (the camera is released while paused; memory and service stay on). */
export function pauseLiveCamera(paused: boolean) {
  if (!android) return;
  try {
    SidekickNative.cameraPause(paused);
  } catch {
    // Not running.
  }
}

/** Hold frame embedding while an answer runs (frames are still saved, embedded after). */
export function holdLiveCamera(hold: boolean) {
  if (!android) return;
  try {
    SidekickNative.cameraHold(hold);
  } catch {
    // Camera module missing: nothing to hold.
  }
}

/** Live on/off changes (from here or the recorder itself); returns an unsubscribe. */
export function onLiveCamera(l: (live: boolean) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Follows the recorder's events and the settings; call once at start-up. Returns a stop
 * function (the camera itself keeps running).
 */
export function watchLiveCamera(): () => void {
  if (!android) return () => {};
  setIngest(liveCameraOn());
  let last = JSON.stringify(config());
  const stopSettings = onSettingsChange(() => {
    const cfg = config();
    const now = JSON.stringify(cfg);
    if (now === last) return;
    last = now;
    try {
      SidekickNative.cameraConfigure(cfg);
    } catch (e) {
      console.log(`[camera] configure failed: ${String(e)}`);
    }
  });
  const sub = SidekickNative.addListener('onCamera', (e) => {
    if (e.kind === 'status') {
      setIngest(e.running);
      listeners.forEach((l) => l(e.running));
      return;
    }
    const n = cameraNotice(e);
    if (n) notices.post(n);
  });
  return () => {
    stopSettings();
    sub.remove();
  };
}

import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { isDownloaded, modelPath } from './downloads';
import {
  alertText,
  CONFIRM_TOK_PER_SEC,
  liveWatches,
  MAX_WATCHES,
  newWatch,
  noteAlert,
  scoreFrame,
  type Watch,
} from './focus-logic';
import { canSpeakNow } from './hands-free';
import { askLlmInBackground, llmBusy } from './llm';
import { EMBEDDER_FILE } from './models';
import { notices } from './notices';
import { SYSTEM_PROMPT } from './prompts';
import { getSettings } from './settings';
import { StreamingSpeaker } from './speaker';
import { setFastIngest } from './live-camera';
import { EMBED_DIMS } from '@/memory/db';
import { onNewFrames } from '@/memory/frames';
import { verifyKeeps } from '@/memory/recall-logic';
import { embedQuery } from '@/memory/search-logic';

/**
 * Camera watches at run time: kept on the phone (app settings store), fed every new embedded
 * frame (frames are drained every 2 s while a watch runs), said once per sighting: spoken when
 * Sidekick may speak, a chat card always, and a notification when the app isn't on screen.
 * Works while Sidekick runs (app open or in the background); see focus-logic.ts for the gate.
 */

const KEY = 'focus.watches.v1';
const CHANNEL = 'followups';

let watches: Watch[] | null = null;
let stopFrames: (() => void) | null = null;
let checking = false;

function load(): Watch[] {
  if (watches) return watches;
  try {
    watches = JSON.parse(SidekickNative.kvGet(KEY) ?? '[]') as Watch[];
  } catch {
    watches = [];
  }
  watches = liveWatches(watches, Date.now());
  return watches;
}

function save() {
  // Similarity windows are working state: not saved (rebuilt from new frames).
  SidekickNative.kvSet(
    KEY,
    JSON.stringify((watches ?? []).map((w) => ({ ...w, sims: [], lastAlertVec: null }))),
  );
  follow();
}

/** Frames flow to the watches only while there are some. */
function follow() {
  const on = !!liveWatches(watches ?? [], Date.now()).length;
  setFastIngest(on);
  if (on && !stopFrames) stopFrames = onNewFrames((f) => void onFrames(f));
  if (!on && stopFrames) {
    stopFrames();
    stopFrames = null;
  }
}

async function embedWords(what: string): Promise<number[] | null> {
  if (!isDownloaded(EMBEDDER_FILE)) return null;
  const [v] = await SidekickNative.embed(modelPath(EMBEDDER_FILE), [embedQuery(what)], EMBED_DIMS);
  return v ?? null;
}

/** Starts a watch; the reply to say. */
export async function addWatch(what: string, every: boolean, now = Date.now()): Promise<string> {
  const ws = load();
  const same = ws.find((w) => w.what === what);
  if (same) {
    same.expiresAt = now + (same.expiresAt - same.createdAt);
    same.every ||= every;
    save();
    return `Still watching for ${what}.`;
  }
  if (ws.length >= MAX_WATCHES)
    return `I can watch for ${MAX_WATCHES} things at once. Say "stop watching for …" first.`;
  const w = newWatch(what, every, now);
  w.vector = await embedWords(what).catch(() => null);
  if (!w.vector) return "I can't watch yet: the memory search model isn't downloaded.";
  ws.push(w);
  save();
  return `OK, I'll tell you when I see ${what}${every ? ', each time' : ''}. I'll stop in 2 hours.`;
}

export function removeWatches(ids: string[]) {
  watches = load().filter((w) => !ids.includes(w.id));
  save();
}

export const currentWatches = () => load().slice();

/** Call once at start-up: picks up watches saved before a restart. */
export function startFocusWatches() {
  if (Platform.OS !== 'android') return;
  load();
  follow();
}

async function onFrames(frames: { at: number; path: string; vector: number[] }[]) {
  const now = Date.now();
  const ws = load();
  const live = liveWatches(ws, now);
  if (live.length !== ws.length) {
    watches = live;
    save();
  }
  for (const f of frames)
    for (const w of [...live]) {
      const v = scoreFrame(w, f.vector, f.at);
      if (v === 'none' || checking) continue;
      checking = true;
      try {
        const confirmed = await confirm(w, f.path, v === 'strong');
        if (confirmed === null) continue;
        const keep = noteAlert(w, f.vector, f.at);
        say(w, f.at, confirmed);
        if (!keep) removeWatches([w.id]);
      } finally {
        checking = false;
      }
    }
}

/**
 * true: Gemma saw it; false: not checked but a strong match (said with "I think"); null: not
 * said. Gemma looks only on phones fast enough and when the model is loaded and free.
 */
async function confirm(w: Watch, path: string, strong: boolean): Promise<boolean | null> {
  const fast = (getSettings().measuredTokPerSec ?? 0) >= CONFIRM_TOK_PER_SEC;
  const free = SidekickNative.llmIsLoaded() && !llmBusy();
  if (!fast || !free) return strong ? false : null;
  try {
    const { text } = await askLlmInBackground(
      `Does this image show ${w.what}? Answer only yes or no.`,
      path,
      { system: SYSTEM_PROMPT, maxTokens: 3 },
    );
    return verifyKeeps(text) ? true : null;
  } catch {
    return strong ? false : null;
  }
}

function say(w: Watch, at: number, confirmed: boolean) {
  const text = alertText(w.what, confirmed);
  notices.post(
    {
      key: `focus:${w.id}:${at}`,
      kind: 'decision',
      text,
      actions: w.every
        ? [{ label: 'Stop watching', id: 'stop' }]
        : [{ label: 'Keep watching', id: 'again' }],
    },
    (action) => {
      if (action === 'stop') removeWatches([w.id]);
      if (action === 'again') void addWatch(w.what, true);
    },
  );
  if (AppState.currentState !== 'active')
    void Notifications.scheduleNotificationAsync({
      content: { title: 'Sidekick', body: text, data: { tag: 'sidekick-focus' } },
      trigger: { channelId: CHANNEL } as Notifications.NotificationTriggerInput,
    }).catch(() => {});
  if (getSettings().speakAnswers && canSpeakNow()) {
    const s = new StreamingSpeaker(true);
    s.finish(text);
  }
}

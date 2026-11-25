import { Directory } from 'expo-file-system';

import SidekickNative, { type LlmLoadResult } from '../../modules/sidekick-native';
import { connection, downloadFile, wifiOnlyDownloads } from './downloads';
import { resetBackendChoice } from './llm';
import { allRequiredFiles } from './llm-candidates';
import {
  type ActiveChat,
  catalogModel,
  type ChatChoice,
  type ChatModelId,
  DEFAULT_CHAT,
  desiredModel,
  formatGB,
  bytesFor,
  modelFilesFor,
  needsSwitch,
  planUpdate,
  type UpdatePolicy,
} from './model-catalog';
import { EMBEDDER_FILE } from './models';
import { notices } from './notices';
import { modelsDir } from './paths';
import { getSettings } from './settings';

/**
 * Which chat model is in use, the user's pick, and fetching a better one in the background
 * (docs/PLAN-v2.md "Models"). Switch-over is safe: the new model is downloaded and checked
 * first, then becomes the first choice with the old one as fallback; the old files are deleted
 * only after the new model has loaded once (noteLlmLoaded). If it never loads, Sidekick goes
 * back to the old one and doesn't retry that build.
 */

const ACTIVE_KEY = 'model.chat.v1';
const CHOICE_KEY = 'model.choice.v1';
const FAILED_KEY = 'model.failed.v1';

function device() {
  const d = SidekickNative.getDeviceInfo();
  return { soc: d.soc, totalRamMb: d.totalRamMb };
}

function readJson<T>(key: string): T | null {
  try {
    const v = SidekickNative.kvGet(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function activeChat(): ActiveChat {
  const saved = readJson<ActiveChat>(ACTIVE_KEY);
  if (saved && catalogModel(saved.id).id === saved.id) return saved;
  // Installs from before model choice existed already have Gemma 4 E2B; a fresh install starts
  // with the Recommended model for this phone (first run downloads it).
  const e2b = catalogModel(DEFAULT_CHAT).generic;
  const id = SidekickNative.fileExists(`${modelsDir()}/${e2b.name}`)
    ? DEFAULT_CHAT
    : desiredModel(chatChoice(), device());
  const a: ActiveChat = { id, sha: catalogModel(id).generic.sha256 };
  SidekickNative.kvSet(ACTIVE_KEY, JSON.stringify(a));
  return a;
}

function setActive(a: ActiveChat) {
  SidekickNative.kvSet(ACTIVE_KEY, JSON.stringify(a));
}

export function chatChoice(): ChatChoice {
  return (SidekickNative.kvGet(CHOICE_KEY) as ChatChoice | null) ?? 'recommended';
}

function updatePolicy(): UpdatePolicy {
  return getSettings().modelUpdates ?? 'auto';
}

export type UpdateState =
  | { phase: 'current' }
  | { phase: 'waiting'; target: ChatModelId; why: string }
  | { phase: 'off'; target: ChatModelId }
  | { phase: 'downloading'; target: ChatModelId; fraction: number; text: string }
  | { phase: 'switching'; target: ChatModelId }
  | { phase: 'failed'; target: ChatModelId; error: string };

let state: UpdateState = { phase: 'current' };
const listeners = new Set<(s: UpdateState) => void>();
let running: Promise<void> | null = null;

function setState(s: UpdateState) {
  state = s;
  listeners.forEach((l) => l(s));
}

export function updateState(): UpdateState {
  return state;
}

export function onUpdateState(l: (s: UpdateState) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The user picked a model (or Recommended) in Settings → Models: fetch it now. */
export function setChatChoice(choice: ChatChoice) {
  SidekickNative.kvSet(CHOICE_KEY, choice);
  SidekickNative.kvSet(FAILED_KEY, null);
  void checkModelUpdates({ userPicked: true });
}

/** Looks for a better or newly picked model and handles it by the update policy. */
export function checkModelUpdates(opts: { userPicked?: boolean } = {}): Promise<void> {
  if (!running) {
    running = check(!!opts.userPicked).finally(() => {
      running = null;
    });
  }
  return running;
}

async function check(userPicked: boolean) {
  const d = device();
  const want = desiredModel(chatChoice(), d);
  const active = activeChat();
  if (!needsSwitch(active, want)) return setState({ phase: 'current' });
  const failed = readJson<string[]>(FAILED_KEY) ?? [];
  if (!userPicked && failed.includes(catalogModel(want).generic.sha256))
    return setState({ phase: 'current' });
  const net = await connection();
  const plan = planUpdate(updatePolicy(), net, userPicked);
  if (plan === 'none') return setState({ phase: 'off', target: want });
  if (plan === 'wait')
    return setState({ phase: 'waiting', target: want, why: 'Waits for Wi-Fi and charging' });
  if (plan === 'ask') {
    setState({ phase: 'waiting', target: want, why: 'Waiting for your OK' });
    notices.post(
      {
        key: 'model-update',
        kind: 'decision',
        text: `A better model for this phone is ready: ${catalogModel(want).label} (${formatGB(bytesFor(want, d.soc))}). Download it on Wi-Fi?`,
        href: '/settings/models',
        actions: [
          { label: 'Download', id: 'download' },
          { label: 'Not now', id: 'later' },
        ],
      },
      (id) => {
        if (id === 'download') void checkModelUpdates({ userPicked: true });
      },
    );
    return;
  }
  await download(active, want, d.soc, userPicked);
}

async function download(active: ActiveChat, want: ChatModelId, soc: string, userPicked: boolean) {
  const files = modelFilesFor(want, soc);
  const total = files.reduce((n, f) => n + f.bytes, 0);
  const done = new Map<string, number>();
  try {
    // Automatic updates stay on Wi-Fi; a user's own pick follows the mobile-data setting.
    const wifiOnly = userPicked ? wifiOnlyDownloads() : true;
    await Promise.all(
      files.map((f) =>
        downloadFile(
          f,
          (text, fraction) => {
            done.set(f.name, fraction * f.bytes);
            const got = [...done.values()].reduce((a, b) => a + b, 0);
            setState({ phase: 'downloading', target: want, fraction: got / total, text });
          },
          wifiOnly,
        ),
      ),
    );
  } catch (e) {
    return setState({
      phase: 'failed',
      target: want,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  setActive({ id: want, sha: catalogModel(want).generic.sha256, previous: active.id });
  resetBackendChoice();
  setState({ phase: 'switching', target: want });
  // Takes effect the next time the model loads: unload it now if nothing is using it.
  if (SidekickNative.llmIsLoaded()) {
    notices.post({
      key: 'model-update',
      kind: 'info',
      text: `${catalogModel(want).label} downloaded; it takes over next time Sidekick starts.`,
      href: '/settings/models',
    });
  }
}

/** Call after every model load: confirms a switch (deleting the old files) or rolls it back. */
export function noteLlmLoaded(r: LlmLoadResult) {
  const a = activeChat();
  if (!a.previous) return;
  const soc = device().soc;
  const newNames = modelFilesFor(a.id, soc).map((f) => f.name);
  const usesNew = newNames.some((n) => r.modelPath.endsWith(`/${n}`));
  if (usesNew) {
    setActive({ id: a.id, sha: a.sha });
    pruneUnusedModels();
    setState({ phase: 'current' });
    notices.post({
      key: 'model-update',
      kind: 'info',
      text: `Now using ${catalogModel(a.id).label}.`,
      href: '/settings/models',
    });
  } else {
    const failed = readJson<string[]>(FAILED_KEY) ?? [];
    SidekickNative.kvSet(FAILED_KEY, JSON.stringify([...failed, a.sha]));
    setActive({ id: a.previous, sha: catalogModel(a.previous).generic.sha256 });
    pruneUnusedModels();
    setState({ phase: 'current' });
    notices.post({
      key: 'model-update',
      kind: 'info',
      text: `${catalogModel(a.id).label} didn't run on this phone; still using ${catalogModel(a.previous).label}.`,
      href: '/settings/models',
    });
  }
}

/** Deletes model files no longer needed (old chat models, earlier builds). */
export function pruneUnusedModels() {
  const keep = new Set(allRequiredFiles(device().soc).map((f) => f.name));
  keep.add(EMBEDDER_FILE.name);
  try {
    for (const e of new Directory(`file://${modelsDir()}`).list()) {
      const name = e.uri.replace(/\/$/, '').split('/').pop() ?? '';
      if (name.endsWith('.litertlm') && !keep.has(name)) {
        SidekickNative.deleteFile(`${modelsDir()}/${name}`);
        console.log(`[models] deleted unused ${name}`);
      }
    }
  } catch (e) {
    console.log(`[models] prune skipped: ${String(e)}`);
  }
}

/**
 * Background checks: now, every 30 minutes, and when the phone starts charging. Returns a stop
 * function. Call once the app is set up.
 */
export function startModelUpdates(): () => void {
  void checkModelUpdates();
  const timer = setInterval(() => void checkModelUpdates(), 30 * 60_000);
  return () => clearInterval(timer);
}

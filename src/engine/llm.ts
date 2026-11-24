import SidekickNative from '../../modules/sidekick-native';
import { ForegroundGate } from './foreground-gate';
import { LlmQueue } from './llm-queue';
import type {
  GenerateOptions,
  LlmBackend,
  LlmLoadResult,
  LlmStats,
  LlmTuning,
} from '../../modules/sidekick-native';
import {
  CALIBRATION_MAX_TOKENS,
  CALIBRATION_PROMPT,
  type Measurement,
  orderBySaved,
  pickFastest,
} from './backend-choice';
import { llmCandidates } from './llm-candidates';
import { modelsDir } from './paths';
import { SYSTEM_PROMPT } from './prompts';

const SAVED_KEY = 'llm.backend.v1';

let loaded: LlmLoadResult | null = null;
let loading: Promise<LlmLoadResult> | null = null;

/** Which backend this phone settled on, if it has calibrated. */
export function savedBackend(): LlmBackend | null {
  return SidekickNative.kvGet(SAVED_KEY) as LlmBackend | null;
}

/** Forget the calibration so the next load measures every chip again. */
export function resetBackendChoice() {
  SidekickNative.kvSet(SAVED_KEY, null);
}

/**
 * Loads the model on the fastest chip that works on this phone. The first time, every chip that
 * loads is timed on a fixed prompt and the winner is remembered; after that it loads directly
 * (falling back to the others only if the saved one stops working, e.g. after a driver update).
 */
export function ensureLlm(onStatus?: (s: string) => void): Promise<LlmLoadResult> {
  if (loaded && SidekickNative.llmIsLoaded()) return Promise.resolve(loaded);
  loaded = null;
  if (!loading) {
    loading = load(onStatus).then(
      async (r) => {
        // Read the fixed system prompt in now, so the first question doesn't wait for it.
        await SidekickNative.llmPrepare(SYSTEM_PROMPT).catch((e) =>
          console.log(`[llm] prepare failed: ${String(e)}`),
        );
        loaded = r;
        loading = null;
        return r;
      },
      (e) => {
        loading = null;
        throw e;
      },
    );
  }
  return loading;
}

async function load(onStatus?: (s: string) => void): Promise<LlmLoadResult> {
  const { soc } = SidekickNative.getDeviceInfo();
  const cands = llmCandidates(soc, modelsDir());
  const saved = savedBackend();
  if (saved) {
    onStatus?.('Loading model…');
    return SidekickNative.llmLoad(orderBySaved(cands, saved));
  }
  const results: Measurement[] = [];
  for (const c of cands) {
    if (!SidekickNative.fileExists(c.modelPath)) continue;
    onStatus?.(`Testing ${c.backend.toUpperCase()} (first run only)…`);
    try {
      await SidekickNative.llmLoad([c]);
      const stats = await SidekickNative.llmGenerate('calibrate', CALIBRATION_PROMPT, null, {
        maxTokens: CALIBRATION_MAX_TOKENS,
      });
      results.push({ candidate: c, stats });
      console.log(
        `[llm] ${c.backend}: read ${stats.prefillTokensPerSec.toFixed(0)}/s write ${stats.decodeTokensPerSec.toFixed(1)}/s`,
      );
    } catch (e) {
      console.log(`[llm] ${c.backend} unusable: ${String(e)}`);
    }
    await SidekickNative.llmUnload();
  }
  const best = pickFastest(results);
  if (!best) throw new Error('No chip on this phone could run the model.');
  SidekickNative.kvSet(SAVED_KEY, best.candidate.backend);
  onStatus?.('Loading model…');
  return SidekickNative.llmLoad(orderBySaved(cands, best.candidate.backend));
}

/** Sets speed knobs (for the bench). Unload and reload for threads/speculative/maxTokens. */
export function setLlmTuning(tuning: LlmTuning) {
  SidekickNative.llmSetTuning(tuning);
}

export async function unloadLlm() {
  loaded = null;
  await SidekickNative.llmUnload();
}

let seq = 0;
const queue = new LlmQueue(() => SidekickNative.llmCancel());

const foreground = new ForegroundGate();
/** The owner is being answered (written or spoken): background passes wait. */
export const holdBackground = () => foreground.hold();
/** The answer is over: background passes may run again. */
export const releaseBackground = () => foreground.release();

/** Something (an answer, fact pass, photo description…) is using the model right now. */
export function llmBusy(): boolean {
  return queue.busy;
}

/** Asks the model; streams text through [onText] and resolves with timing stats. */
export async function askLlm(
  prompt: string,
  imagePath: string | null,
  onText: (full: string) => void,
  opts?: GenerateOptions,
  background = false,
): Promise<{ text: string; stats: LlmStats }> {
  await ensureLlm();
  return queue.run(background, () => generate(prompt, imagePath, onText, opts));
}

/** A background pass (facts, follow-ups, photo descriptions): waits its turn, yields to questions. */
export async function askLlmInBackground(
  prompt: string,
  imagePath: string | null,
  opts?: GenerateOptions,
): Promise<{ text: string; stats: LlmStats }> {
  // Not while an answer is written or spoken: it would slow the answer's first spoken word.
  await foreground.idle();
  // Its own throwaway chat: a spoken follow-up must never continue a background prompt's chat.
  return askLlm(prompt, imagePath, () => {}, { ...opts, scratch: true }, true);
}

async function generate(
  prompt: string,
  imagePath: string | null,
  onText: (full: string) => void,
  opts?: GenerateOptions,
): Promise<{ text: string; stats: LlmStats }> {
  const id = `ask-${++seq}`;
  let text = '';
  const sub = SidekickNative.addListener('onLlmText', (e) => {
    if (e.requestId !== id) return;
    text += e.text;
    onText(text);
  });
  try {
    const stats = await SidekickNative.llmGenerate(id, prompt, imagePath, opts);
    return { text, stats };
  } finally {
    sub.remove();
  }
}

/**
 * A short side task (e.g. writing search words) in its own throwaway chat with the usual system
 * prompt: the spoken conversation's history is kept, and none of it is seen. Only when the model
 * is already loaded and idle; otherwise it fails at once.
 */
export async function askLlmAside(prompt: string, maxTokens: number): Promise<string> {
  if (!SidekickNative.llmIsLoaded() || queue.busy) throw new Error('model busy or not loaded');
  const { text } = await askLlm(prompt, null, () => {}, {
    system: SYSTEM_PROMPT,
    maxTokens,
    scratch: true,
  });
  return text;
}

/** Drops the last chat turn sent with `undoable` (e.g. a "LOOKUP" reply); false if none. */
export function undoLastTurn(): boolean {
  return SidekickNative.llmUndoLast();
}

export function cancelLlm() {
  SidekickNative.llmCancel();
}

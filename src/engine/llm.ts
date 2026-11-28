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
/** Bumped each time the model loads: a chat from an earlier load is gone. */
let loads = 0;
/** The system prompt the next fresh chat starts with (the usual one plus the running summary). */
let chatSystemNow = SYSTEM_PROMPT;

let chatSystemSource: (() => string) | null = null;

/** Where a load finds the current chat's system prompt (set by the assistant), to read it in early. */
export function setChatSystemSource(source: () => string) {
  chatSystemSource = source;
}

/** How many times the model has loaded (a chat started under another count no longer exists). */
export const llmLoadCount = () => loads;

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
const loadListeners = new Set<(r: LlmLoadResult) => void>();
/** Called after each model load (model updates confirm a switch from it). */
export function onLlmLoaded(l: (r: LlmLoadResult) => void): () => void {
  loadListeners.add(l);
  return () => loadListeners.delete(l);
}

export function ensureLlm(onStatus?: (s: string) => void): Promise<LlmLoadResult> {
  if (loaded && SidekickNative.llmIsLoaded()) return Promise.resolve(loaded);
  loaded = null;
  if (!loading) {
    loading = load(onStatus).then(
      async (r) => {
        // Read the fixed system prompt in now, so the first question doesn't wait for it.
        loads++;
        try {
          if (chatSystemSource) chatSystemNow = chatSystemSource();
        } catch (e) {
          console.log(`[llm] chat prompt unavailable: ${String(e)}`);
        }
        await SidekickNative.llmPrepare(chatSystemNow).catch((e) =>
          console.log(`[llm] prepare failed: ${String(e)}`),
        );
        loaded = r;
        loading = null;
        for (const l of loadListeners) {
          try {
            l(r);
          } catch (e) {
            console.log(`[llm] load listener failed: ${String(e)}`);
          }
        }
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
  // The answer was stopped: the steps it would still take (routing, filling a tool, the lookup's
  // second pass) get nothing, so no action runs and nothing more is written after Stop.
  if (stopping && !background) return { text: '', stats: NO_STATS };
  await ensureLlm();
  return queue.run(background, async () => {
    try {
      return await generate(prompt, imagePath, onText, opts);
    } catch (e) {
      // Freed for low memory between loading and asking (MemoryWatch): load again, ask once more.
      if (!/not loaded/i.test(String(e)) || SidekickNative.llmIsLoaded()) throw e;
      await ensureLlm();
      return generate(prompt, imagePath, onText, opts);
    }
  });
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
  } catch (e) {
    // Stop or Send now while it writes: LiteRT-LM ends a cancelled pass with an error ("Task
    // cancelled"), not as done. The answer keeps what it wrote, so it is shown, saved and
    // remembered by the chat like any other (phone check, 27 Nov: the next question had lost it).
    if (stopping) return { text, stats: NO_STATS };
    throw e;
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

/**
 * The next fresh chat starts with [system]: read it in now, in the background (after any answer),
 * so that question doesn't wait for it.
 */
export function prepareChat(system: string) {
  chatSystemNow = system;
  if (!loaded || !SidekickNative.llmIsLoaded()) return;
  void foreground
    .idle()
    .then(() => queue.run(true, () => SidekickNative.llmPrepare(system)))
    .catch((e) => console.log(`[llm] prepare failed: ${String(e)}`));
}

/** Background passes stopped by a question so far. */
export const backgroundPreemptions = () => queue.preemptions;

/** Drops the last chat turn sent with `undoable` (e.g. a "LOOKUP" reply); false if none. */
export function undoLastTurn(): boolean {
  return SidekickNative.llmUndoLast();
}

export function cancelLlm() {
  SidekickNative.llmCancel();
}

const NO_STATS: LlmStats = {
  ttftMs: 0,
  prefillTokens: 0,
  prefillTokensPerSec: 0,
  decodeTokens: 0,
  decodeTokensPerSec: 0,
  totalMs: 0,
};
let stopping = false;

/**
 * Stop (or Send now) on the chat's answer: the model pass running now ends with what it wrote,
 * and every later foreground pass of that answer returns nothing at once, until [answerOver].
 */
export function stopAnswer() {
  stopping = true;
  SidekickNative.llmCancel();
}

/** The chat's answer has ended (or a new one starts): the model answers normally again. */
export function answerOver() {
  stopping = false;
}

/** Stop was pressed on the answer being written. */
export const answerStopped = () => stopping;

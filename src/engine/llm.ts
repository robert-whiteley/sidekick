import SidekickNative from '../../modules/sidekick-native';
import type {
  GenerateOptions,
  LlmBackend,
  LlmLoadResult,
  LlmStats,
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
      (r) => {
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

export async function unloadLlm() {
  loaded = null;
  await SidekickNative.llmUnload();
}

let seq = 0;

/** Asks the model; streams text through [onText] and resolves with timing stats. */
export async function askLlm(
  prompt: string,
  imagePath: string | null,
  onText: (full: string) => void,
  opts?: GenerateOptions,
): Promise<{ text: string; stats: LlmStats }> {
  await ensureLlm();
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

export function cancelLlm() {
  SidekickNative.llmCancel();
}

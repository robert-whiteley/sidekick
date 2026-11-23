import type { LlmCandidate } from '../../modules/sidekick-native';
import { EMBEDDER_FILE, MODEL_FILES, type ModelFile, SPEECH_FILES } from './models';

/** Gemma 4 E2B builds published by Google (litert-community/gemma-4-E2B-it-litert-lm). */
export const GEMMA_GENERIC = MODEL_FILES.gemmaGeneric.name;
export const GEMMA_TENSOR: Record<string, string> = {
  G5: MODEL_FILES.gemmaTensorG5.name,
  G6: MODEL_FILES.gemmaTensorG6.name,
};

/** Returns the Tensor generation ("G5", "G6") for a Pixel SoC string, or null. */
export function tensorGeneration(soc: string): string | null {
  const m = /tensor\s*(g\d+)/i.exec(soc);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Ways to run the model on this phone, fastest first. The native side tries each in order and
 * keeps the first that loads, so unsupported hardware falls back without user action.
 */
export function llmCandidates(soc: string, modelsDir: string): LlmCandidate[] {
  const dir = modelsDir.replace(/\/$/, '');
  const out: LlmCandidate[] = [];
  const gen = tensorGeneration(soc);
  if (gen && GEMMA_TENSOR[gen]) {
    out.push({ modelPath: `${dir}/${GEMMA_TENSOR[gen]}`, backend: 'tensor' });
  }
  out.push({ modelPath: `${dir}/${GEMMA_GENERIC}`, backend: 'gpu' });
  out.push({ modelPath: `${dir}/${GEMMA_GENERIC}`, backend: 'cpu' });
  return out;
}

/** Model files this phone needs: the AI-chip build on Pixels that have one, plus the generic one. */
export function requiredModelFiles(soc: string): ModelFile[] {
  const gen = tensorGeneration(soc);
  const tensor =
    gen === 'G5' ? MODEL_FILES.gemmaTensorG5 : gen === 'G6' ? MODEL_FILES.gemmaTensorG6 : null;
  return tensor ? [tensor, MODEL_FILES.gemmaGeneric] : [MODEL_FILES.gemmaGeneric];
}

/** Everything the app downloads on first run: chat model, speech models, memory search model. */
export function allRequiredFiles(soc: string): ModelFile[] {
  return [...requiredModelFiles(soc), ...SPEECH_FILES, EMBEDDER_FILE];
}

import type { LlmCandidate } from '../../modules/sidekick-native';

/** Gemma 4 E2B builds published by Google (litert-community/gemma-4-E2B-it-litert-lm). */
export const GEMMA_GENERIC = 'gemma-4-E2B-it.litertlm';
export const GEMMA_TENSOR: Record<string, string> = {
  G5: 'gemma-4-E2B-it_Google_Tensor_G5.litertlm',
  G6: 'gemma-4-E2B-it_Google_Tensor_G6.litertlm',
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

import { Platform } from 'react-native';

import type { LlmCandidate } from '../../modules/sidekick-native';
import {
  type ActiveChat,
  catalogModel,
  DEFAULT_CHAT,
  modelFilesFor,
  tensorGeneration,
} from './model-catalog';
import { EMBEDDER_FILE, MODEL_FILES, type ModelFile, OCR_FILES, SPEECH_FILES } from './models';

export { tensorGeneration };

/** Gemma 4 E2B builds published by Google (litert-community/gemma-4-E2B-it-litert-lm). */
export const GEMMA_GENERIC = MODEL_FILES.gemmaGeneric.name;
export const GEMMA_TENSOR: Record<string, string> = {
  G5: MODEL_FILES.gemmaTensorG5.name,
  G6: MODEL_FILES.gemmaTensorG6.name,
};

const FALLBACK: ActiveChat = { id: DEFAULT_CHAT, sha: MODEL_FILES.gemmaGeneric.sha256 };

/** The chat model in use (model-updates.ts); Gemma 4 E2B where that can't be read (tests). */
function currentChat(): ActiveChat {
  try {
    // Lazy: model-updates reads native storage, which plain unit tests don't have.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./model-updates') as typeof import('./model-updates')).activeChat();
  } catch {
    return FALLBACK;
  }
}

function candidatesFor(
  id: ActiveChat['id'],
  soc: string,
  dir: string,
  ios: boolean,
): LlmCandidate[] {
  const m = catalogModel(id);
  // iPhone: CPU only for now (LiteRT-LM's iOS framework has no Metal accelerator yet, ADR 0006).
  if (ios) return [{ modelPath: `${dir}/${m.generic.name}`, backend: 'cpu' }];
  const out: LlmCandidate[] = [];
  const gen = tensorGeneration(soc);
  const t = gen ? m.tensor[gen] : undefined;
  if (t) out.push({ modelPath: `${dir}/${t.name}`, backend: 'tensor' });
  out.push({ modelPath: `${dir}/${m.generic.name}`, backend: 'gpu' });
  out.push({ modelPath: `${dir}/${m.generic.name}`, backend: 'cpu' });
  return out;
}

/**
 * Ways to run the model on this phone, fastest first. The native side tries each in order and
 * keeps the first that loads, so unsupported hardware falls back without user action. Right
 * after a model switch the previous model follows as the fallback.
 */
export function llmCandidates(
  soc: string,
  modelsDir: string,
  chat: ActiveChat = currentChat(),
  ios = Platform.OS === 'ios',
): LlmCandidate[] {
  const dir = modelsDir.replace(/\/$/, '');
  const out = candidatesFor(chat.id, soc, dir, ios);
  if (chat.previous && chat.previous !== chat.id)
    out.push(...candidatesFor(chat.previous, soc, dir, ios));
  return out;
}

/** Chat-model files this phone needs: the AI-chip build on Pixels that have one, plus the generic. */
export function requiredModelFiles(soc: string, chat: ActiveChat = currentChat()): ModelFile[] {
  return modelFilesFor(chat.id, soc);
}

/** The required speech files; language.ts swaps in its language-aware list when it loads. */
let speechFiles: () => ModelFile[] = () => SPEECH_FILES;
export function setRequiredSpeechFiles(source: () => ModelFile[]) {
  speechFiles = source;
}

/**
 * Everything the app downloads on first run: chat model, speech, memory search, photo text.
 * The iPhone needs only the chat model and memory search: speech-to-text and photo text are
 * built into iOS (Apple's on-device recognizer and Vision).
 */
export function allRequiredFiles(
  soc: string,
  chat: ActiveChat = currentChat(),
  ios = Platform.OS === 'ios',
): ModelFile[] {
  if (ios) return [...requiredModelFiles(soc, chat), EMBEDDER_FILE];
  return [
    ...requiredModelFiles(soc, chat),
    ...speechFiles(),
    EMBEDDER_FILE,
    ...Object.values(OCR_FILES),
  ];
}

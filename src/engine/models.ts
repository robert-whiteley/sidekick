/** Files the app downloads, pinned by SHA-256 so a tampered or corrupt file is never loaded. */
export type ModelFile = {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  /** For .tar.bz2 archives: a file inside that proves it was unpacked. */
  unpackedCheck?: string;
};

const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const HF = 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main';

export const MODEL_FILES = {
  gemmaGeneric: {
    name: 'gemma-4-E2B-it.litertlm',
    url: `${HF}/gemma-4-E2B-it.litertlm`,
    sha256: '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c',
    bytes: 2588147712,
  },
  gemmaTensorG5: {
    name: 'gemma-4-E2B-it_Google_Tensor_G5.litertlm',
    url: `${HF}/gemma-4-E2B-it_Google_Tensor_G5.litertlm`,
    sha256: '72d056066f34362adcecf6b76995de67ad899f6f33dfe9079593c1acd2984191',
    bytes: 3206299658,
  },
  gemmaTensorG6: {
    name: 'gemma-4-E2B-it_Google_Tensor_G6.litertlm',
    url: `${HF}/gemma-4-E2B-it_Google_Tensor_G6.litertlm`,
    sha256: 'd6cbe8d625f4965a8c32565f65ae774d19598d0d967a4c2101a7e04988daaf58',
    bytes: 3453960202,
  },
  benchPhoto: {
    name: 'test.jpg',
    url: 'https://raw.githubusercontent.com/robert-whiteley/sidekick/main/assets/bench/test.jpg',
    sha256: '1ff925eb7fc6cd39ababdfede93b2103a26638c26350a00f3da96157bd8c9ac9',
    bytes: 44731,
  },
  // Speech (sherpa-onnx). Small, CPU-only, always resident while listening.
  vad: {
    name: 'silero_vad.onnx',
    url: `${SHERPA}/asr-models/silero_vad.onnx`,
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    bytes: 643854,
  },
  wakeWord: {
    name: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
    url: `${SHERPA}/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2`,
    sha256: 'f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a',
    bytes: 17626723,
    unpackedCheck: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01/tokens.txt',
  },
  speechToText: {
    name: 'sherpa-onnx-moonshine-base-en-quantized-2026-02-27.tar.bz2',
    url: `${SHERPA}/asr-models/sherpa-onnx-moonshine-base-en-quantized-2026-02-27.tar.bz2`,
    sha256: '43232c1d13013d37317163baec3135bd771a186a4356f28c889bab453bb0e891',
    bytes: 111266225,
    unpackedCheck: 'sherpa-onnx-moonshine-base-en-quantized-2026-02-27/tokens.txt',
  },
  voiceprint: {
    name: '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
    url: 'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
    sha256: '98daf9bcf1c8abf3db374fec4c27a5eda7c58705bb3f180d057b085a72a88bb5',
    bytes: 29596979,
  },
} satisfies Record<string, ModelFile>;

export const EMBEDDER_FILE: ModelFile = {
  name: 'embeddinggemma-2-text-270m.litertlm',
  url: 'https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/main/embeddinggemma-2-text-270m.litertlm',
  sha256: '2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb',
  bytes: 164626432,
};

export const SPEECH_FILES: ModelFile[] = [
  MODEL_FILES.vad,
  MODEL_FILES.wakeWord,
  MODEL_FILES.speechToText,
  MODEL_FILES.voiceprint,
];

/** "1.2 / 2.6 GB (46%)" */
export function formatProgress(bytes: number, total: number): string {
  const gb = (n: number) => (n / 1e9).toFixed(1);
  if (total <= 0) return `${gb(bytes)} GB`;
  return `${gb(bytes)} / ${gb(total)} GB (${Math.floor((bytes / total) * 100)}%)`;
}

/** Model files earlier versions downloaded that are no longer used; deleted to free space. */
export const OBSOLETE_MODEL_PATHS = [
  'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01-mobile',
  'sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27',
];

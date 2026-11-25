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
    // Checked against the Hugging Face file list, 25 Nov 2026.
    sha256: 'd6cbe8d625f4965a8c32565f65ae774d19598d0d967a4c2101a7e04988daaf58',
    bytes: 3453960202,
  },
  // Gemma 4 E4B (Apache-2.0): smarter, slower; Recommended on phones with 12 GB+ RAM.
  gemmaE4B: {
    name: 'gemma-4-E4B-it.litertlm',
    url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm',
    sha256: '0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0',
    bytes: 3659530240,
  },
  // Speech (sherpa-onnx). Small, CPU-only, always resident while listening.
  vad: {
    name: 'silero_vad_v6.2.3.onnx',
    url: 'https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx',
    sha256: '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3',
    bytes: 2327524,
  },
  wakeWord: {
    name: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
    url: `${SHERPA}/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2`,
    sha256: 'f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a',
    bytes: 17626723,
    unpackedCheck: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01/tokens.txt',
  },
  speechToText: {
    name: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2',
    url: `${SHERPA}/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2`,
    sha256: '6fc4426b54aa549a0019b8a75b8dea59164e71790a37ac56a045ad57f915f714',
    bytes: 482440461,
    unpackedCheck: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/tokens.txt',
  },
  voiceprint: {
    name: '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
    url: 'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
    sha256: '98daf9bcf1c8abf3db374fec4c27a5eda7c58705bb3f180d057b085a72a88bb5',
    bytes: 29596979,
  },
  // Sidekick's voice: Kyutai Pocket TTS 100M (CC BY 4.0) via sherpa-onnx. Optional: the system
  // voice speaks until it is downloaded (Wi-Fi only). No phonemizer, so no espeak-ng (GPL).
  voice: {
    name: 'sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2',
    url: `${SHERPA}/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2`,
    sha256: 'f4da7c7bd465f7b91e89191487fe90504396a51d6f0bcf94d0787633e2657293',
    bytes: 98337865,
    // Must match Voice.kt (DIR + the reference voice it reads).
    unpackedCheck: 'sherpa-onnx-pocket-tts-int8-2026-01-26/test_wavs/bria.wav',
  },
  // End of a spoken turn: Smart Turn v3.2 (pipecat-ai, BSD-2-Clause), pinned to a commit. The fp32
  // export (upstream names it "gpu"; it runs on the CPU). Optional: turns end on silence alone until
  // it is downloaded (Wi-Fi only). Must match SmartTurn.kt (FILE).
  smartTurn: {
    name: 'smart-turn-v3.2-gpu.onnx',
    url: 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93/smart-turn-v3.2-gpu.onnx',
    sha256: 'ab8dc64b88713f90b571c15b714bd1330e6c883cad8763dacf65c9376dc539be',
    bytes: 32411198,
  },
} satisfies Record<string, ModelFile>;

/** Fetched in the background once the speech models are in; the app works without them. */
export const OPTIONAL_SPEECH_FILES: ModelFile[] = [MODEL_FILES.voice, MODEL_FILES.smartTurn];

/**
 * EmbeddingGemma 2 text + vision: text and photos land in one vector space, so a typed question
 * finds a photo by what it shows. Same 270M text backbone as the text-only file, plus a 170M
 * vision encoder that loads only when a photo is embedded.
 */
export const EMBEDDER_FILE: ModelFile = {
  name: 'embeddinggemma-2-text-vision-440m.litertlm',
  url: 'https://huggingface.co/litert-community/embeddinggemma-2-text-vision-440m-litert-lm/resolve/main/embeddinggemma-2-text-vision-440m.litertlm',
  sha256: '92dcbea108899e5d6e30d919b0744f90d9967e80c67a4ab5503ac16d54f62eb0',
  bytes: 387710976,
};

export const SPEECH_FILES: ModelFile[] = [
  MODEL_FILES.vad,
  MODEL_FILES.wakeWord,
  MODEL_FILES.speechToText,
  MODEL_FILES.voiceprint,
];

/**
 * PaddleOCR PP-OCRv6 small (Apache-2.0), PaddlePaddle's own ONNX exports, pinned to a commit:
 * text detection, text recognition, and the recognizer's config (its character list).
 */
const PPOCR = 'https://huggingface.co/PaddlePaddle';
export const OCR_FILES = {
  det: {
    name: 'pp-ocrv6-small-det.onnx',
    url: `${PPOCR}/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx`,
    sha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e',
    bytes: 9880512,
  },
  rec: {
    name: 'pp-ocrv6-small-rec.onnx',
    url: `${PPOCR}/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.onnx`,
    sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634',
    bytes: 21159378,
  },
  dict: {
    name: 'pp-ocrv6-small-rec.yml',
    url: `${PPOCR}/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.yml`,
    sha256: 'ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1',
    bytes: 150579,
  },
} satisfies Record<string, ModelFile>;

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
  'sherpa-onnx-moonshine-base-en-quantized-2026-02-27',
  'silero_vad.onnx',
  'silero_vad_v5.onnx',
  'embeddinggemma-2-text-270m.litertlm',
];

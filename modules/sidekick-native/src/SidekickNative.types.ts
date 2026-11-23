export type LlmBackend = 'tensor' | 'npu' | 'gpu' | 'cpu';

export type LlmCandidate = { modelPath: string; backend: LlmBackend };

export type LlmLoadResult = {
  modelPath: string;
  backend: LlmBackend;
  initMs: number;
  /** Backends tried before the one that worked, with the reason each failed. */
  failures: string[];
};

export type LlmStats = {
  ttftMs: number;
  prefillTokens: number;
  prefillTokensPerSec: number;
  decodeTokens: number;
  decodeTokensPerSec: number;
  totalMs: number;
};

export type DeviceInfo = {
  manufacturer: string;
  model: string;
  soc: string;
  totalRamMb: number;
  filesDir: string;
  externalFilesDir: string | null;
};

export type SidekickNativeModuleEvents = {
  onLlmText: (event: { requestId: string; text: string }) => void;
};

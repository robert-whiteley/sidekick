export type LlmBackend = 'tensor' | 'npu' | 'gpu' | 'cpu';

export type LlmCandidate = { modelPath: string; backend: LlmBackend };

export type LlmLoadResult = {
  modelPath: string;
  backend: LlmBackend;
  initMs: number;
  /** Backends tried before the one that worked, with the reason each failed. */
  failures: string[];
};

export type GenerateOptions = {
  /** Stop after this many tokens. */
  maxTokens?: number;
  /** Continue the previous conversation instead of starting fresh. */
  keepHistory?: boolean;
  /** System instruction for a fresh conversation. */
  system?: string;
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
  onWake: (event: Record<string, never>) => void;
  onTranscript: (event: { kind: 'speech' | 'question'; text: string; at: number }) => void;
  onQuestion: (event: { text: string }) => void;
  onListenError: (event: { message: string }) => void;
};

/** One line of the native journal (see Journal in MicLoop.kt). */
export type JournalEntry =
  | {
      kind: 'speech' | 'question';
      at: number;
      durationMs: number;
      text: string;
      owner: boolean;
      voice: number[] | null;
    }
  | { kind: 'answer'; at: number; text: string; question: string };

export type DownloadStatus = {
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed';
  bytes: number;
  total: number;
  reason: number;
};

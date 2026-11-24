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
  /**
   * Run in a separate throwaway conversation: the current chat (and its history) is left as it
   * is. For short side tasks such as writing search words.
   */
  scratch?: boolean;
  /** Keep a copy of the chat from before this turn, so `llmUndoLast()` can drop the turn. */
  undoable?: boolean;
};

/** Speed knobs a bench can try; omitted = library default. */
export type LlmTuning = {
  /** CPU worker threads (applies on next load). */
  threads?: number;
  /** Speculative decoding / multi-token prediction (applies on next load). */
  speculative?: 'off' | 'on' | 'adaptive';
  /** Image tokens per photo, e.g. 70, 140, 280, 560, 1120; fewer reads faster. */
  visualTokenBudget?: number;
  /** Context size in tokens (applies on next load). */
  maxTokens?: number;
  /** Longest photo edge handed to the model, px (default 768). */
  maxImageEdge?: number;
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
  /** followUp: said during or right after an answer (no wake word), so the chat continues. */
  onQuestion: (event: { text: string; followUp?: boolean }) => void;
  /** The user talked over Sidekick: the voice and the running answer were stopped natively. */
  onBargeIn: (event: Record<string, never>) => void;
  /** Sidekick finished (or stopped) speaking; the ~8 s follow-up window is open. */
  onVoiceIdle: (event: Record<string, never>) => void;
  onListenError: (event: { message: string }) => void;
  /** Auto-pause began (reason, e.g. "quiet hours", "at Work") or ended (null). */
  onListenPause: (event: { reason: string | null }) => void;
};

/** One line of the native journal (see Journal in MicLoop.kt). */
/** Where the phone was, when known (location permission granted and a fix ≤ 2 h old). */
export type JournalPlace = { lat?: number; lon?: number };

export type JournalEntry = JournalPlace &
  (
    | {
        kind: 'speech' | 'question';
        at: number;
        durationMs: number;
        text: string;
        owner: boolean;
        voice: number[] | null;
      }
    | { kind: 'answer'; at: number; text: string; question: string }
  );

export type DeviceLocation = { lat: number; lon: number; accuracyM: number; at: number };

export type DownloadStatus = {
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed';
  bytes: number;
  total: number;
  reason: number;
};

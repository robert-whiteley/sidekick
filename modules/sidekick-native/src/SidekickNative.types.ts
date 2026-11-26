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
  /**
   * Use the separate "Off the record" chat (keepHistory continues it). The main chat is left as it
   * is; the next main-chat turn closes the off-the-record one.
   */
  offRecord?: boolean;
};

/** The one voice this phone uses (see Voice.kt). */
export type VoiceInfo = {
  /** Decided once from the timing run; null until Pocket has been downloaded and timed. */
  choice: 'pocket' | 'system' | null;
  /** Pocket's first-sound time on a short sentence, ms (null: not measured or failed). */
  measuredMs: number | null;
  /** The owner's setting. */
  override: 'auto' | 'pocket' | 'system';
  /** What speaks now. */
  active: 'pocket' | 'system';
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
  /** Live camera: started/stopped, slowed down (heat/battery/memory), storage short, camera lost. */
  onCamera: (event: CameraEvent) => void;
  /** Android said memory is short: big models were freed natively (they reload on demand). */
  onMemoryPressure: (event: { level: 'low' | 'critical'; freed: string[] }) => void;
  onLlmText: (event: { requestId: string; text: string }) => void;
  onWake: (event: Record<string, never>) => void;
  onTranscript: (event: { kind: 'speech' | 'question'; text: string; at: number }) => void;
  /** Words said so far while the user is still talking (replaced by the final text). */
  onPartialTranscript: (event: { text: string; source: 'ptt' | 'question' }) => void;
  /** followUp: said during or right after an answer (no wake word), so the chat continues. */
  onQuestion: (event: { text: string; followUp?: boolean }) => void;
  /** The user talked over Sidekick: the voice and the running answer were stopped natively. */
  onBargeIn: (event: Record<string, never>) => void;
  /** Sidekick finished (or stopped) speaking; the ~8 s follow-up window is open. */
  onVoiceIdle: (event: Record<string, never>) => void;
  onListenError: (event: { message: string }) => void;
  /** Auto-pause began (reason, e.g. "quiet hours", "at Work") or ended (null). */
  onListenPause: (event: { reason: string | null }) => void;
  /** A USB camera was plugged in / unplugged, or its permission answered. */
  onUsbCamera: (event: UsbCameraEvent) => void;
  /** Audio inputs or outputs changed (headphones, Bluetooth, USB mic). */
  onAudioDevices: (event: AudioDevices) => void;
  /** Headset / Bluetooth button while media buttons are on. */
  onMediaButton: (event: { action: 'ask' | 'next' | 'previous' }) => void;
};

export type UsbCameraEvent = {
  kind: 'usbCamera';
  attached: boolean;
  name: string;
  /** true once allowed, false if refused, null when unknown (e.g. unplugged). */
  permission: boolean | null;
};

export type AudioPortInfo = {
  id: number;
  /** Stable across reconnects ("usb:Arducam"); what a saved choice uses. */
  key: string;
  kind: 'usb' | 'wired' | 'bluetooth' | 'phone';
  name: string;
};

export type AudioDevices = {
  inputs: AudioPortInfo[];
  outputs: AudioPortInfo[];
  /** Keys in use now (null: system default). */
  input: string | null;
  output: string | null;
  recommendedInput: string | null;
  recommendedOutput: string | null;
};

export type SplitAudioProbe = {
  possible: boolean;
  tested: boolean;
  reason: string;
  inputs?: string[];
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
        /** The line's saved audio (Opus/Ogg), absent when not saved (e.g. Off the record). */
        audioPath?: string;
      }
    | { kind: 'answer'; at: number; text: string; question: string }
    | {
        /** A position while listening (Places.kt); 'parked' when the car's Bluetooth went. */
        kind: 'location';
        at: number;
        lat: number;
        lon: number;
        accM?: number;
        speedMs?: number;
        source: 'fix' | 'parked';
      }
  );

export type DeviceLocation = { lat: number; lon: number; accuracyM: number; at: number };

export type DownloadStatus = {
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed';
  bytes: number;
  total: number;
  reason: number;
};

/** Live camera memory settings (all optional; defaults are the Recommended values). */
export type CameraConfig = {
  /** 'auto' (USB camera when one is open, else the phone's), 'usb' or 'phone'. */
  source?: 'auto' | 'usb' | 'phone';
  lens?: 'back' | 'front';
  /** Frames looked at per second (default 2). */
  sampleFps?: number;
  recordVideo?: boolean;
  /** Video frame rate (default 10) and height (default 720). */
  videoFps?: number;
  videoHeight?: number;
  /** Length of each closed video file (default 3 s). */
  segmentSec?: number;
  videoBitrate?: number;
  codec?: 'avc' | 'hevc';
  /** Video kept this long (default 48 h), then deleted oldest first. */
  keepVideoHours?: number;
  /** 0 = no cap besides the free-space reserve. */
  maxVideoMb?: number;
  /** 0 = keep stills as long as their memories. */
  keepStillsDays?: number;
  /** 0 = Recommended: max(2 GB, 10 % of storage). */
  reserveMb?: number;
  /** 0..1 frame difference below which a frame counts as a repeat (default 0.04). */
  dedupeThreshold?: number;
  keyframeMaxGapSec?: number;
  keyframeEdge?: number;
  /** Recent frames kept for live questions (default 4). */
  liveFrames?: number;
  embedModelPath?: string | null;
  dims?: number;
  ocrDetPath?: string | null;
  ocrRecPath?: string | null;
  ocrDictPath?: string | null;
  ocrEveryMs?: number;
  /** Keep filming with the screen off / locked (default true). */
  whileLocked?: boolean;
};

export type CameraStatus = {
  running: boolean;
  source: string;
  activeSource: 'usb' | 'phone' | null;
  paused: boolean;
  sampleFps: number;
  videoFps: number;
  recording: boolean;
  /** Why rates are lowered right now, if they are. */
  reason: 'heat' | 'battery' | 'memory' | null;
  videoBlockedForSpace: boolean;
  framesSeen: number;
  framesKept: number;
  pendingEmbeds: number;
  startedAt: number | null;
  /** Paused from the notification or by voice. */
  userPaused: boolean;
  /** Paused because the phone is locked and filming while locked is off. */
  lockPaused: boolean;
};

export type CameraEvent =
  | { kind: 'status'; running: boolean; userPaused?: boolean }
  | {
      kind: 'throttle';
      from: number;
      to: number;
      /** 0 = no video. */
      videoFrom: number;
      videoTo: number;
      paused: boolean;
      /** null: back to normal. */
      reason: 'heat' | 'battery' | 'memory' | null;
      tempC: number | null;
      batteryPct: number;
    }
  /** reserve: under the reserve (video paused, stills cleared); full: no frames stored at all. */
  | { kind: 'storage'; reason: 'reserve' | 'full' | 'ok'; shortBytes: number; video: boolean }
  | { kind: 'lost'; reason: string; fallback?: 'phone' };

/** A finished video file overlapping the asked window: play [path] from offsetMs for durationMs. */
export type VideoSlice = {
  path: string;
  startMs: number;
  endMs: number;
  offsetMs: number;
  durationMs: number;
};

export type FrameRef = { at: number; path: string };

export type CameraStorage = {
  videoBytes: number;
  stillsBytes: number;
  framesBytes: number;
  pendingBytes: number;
  freeBytes: number;
  totalBytes: number;
  reserveBytes: number;
  oldestVideoAt: number | null;
};

/** thermalStatus: Android PowerManager.THERMAL_STATUS_* (0 none … 6 shutdown). */
export type DeviceState = {
  thermalStatus: number;
  batteryPct: number;
  charging: boolean;
  lowMemory: boolean;
  tempC: number | null;
};

/** One line of cameraFramesDrain() (JSON): an embedded keyframe for memory. */
export type FrameJournalEntry = JournalPlace & {
  kind: 'frame';
  at: number;
  /** Keyframe JPEG (~640 px). */
  path: string;
  /** EmbeddingGemma 2 vector (same space as photos and text), null without a model. */
  vector: number[] | null;
  /** Text or a number plate was in view: run OCR on stillPath. */
  ocrNeeded: boolean;
  stillPath: string | null;
  source: 'usb' | 'phone' | string;
};

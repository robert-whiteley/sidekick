import { NativeModule, requireNativeModule } from 'expo';
import { Platform } from 'react-native';

import type {
  CameraConfig,
  CameraStatus,
  CameraStorage,
  DeviceState,
  FrameRef,
  VideoSlice,
  AudioDevices,
  SplitAudioProbe,
  DeviceInfo,
  DeviceLocation,
  DownloadStatus,
  GenerateOptions,
  LlmCandidate,
  LlmLoadResult,
  LlmStats,
  LlmTuning,
  SidekickNativeModuleEvents,
  VoiceInfo,
} from './SidekickNative.types';
import { withIosFallbacks } from './ios-fallbacks';

declare class SidekickNativeModule extends NativeModule<SidekickNativeModuleEvents> {
  getDeviceInfo(): DeviceInfo;
  llmLoad(candidates: LlmCandidate[]): Promise<LlmLoadResult>;
  llmGenerate(
    requestId: string,
    prompt: string,
    imagePath: string | null,
    opts?: GenerateOptions,
  ): Promise<LlmStats>;
  /** Speed knobs (bench). Threads/speculative/maxTokens apply on the next load. */
  llmSetTuning(tuning: LlmTuning): void;
  /** Reads the system prompt in ahead of the first question; false if no model is loaded. */
  llmPrepare(system: string | null): Promise<boolean>;
  /** Small persistent settings (not for secrets). */
  kvGet(key: string): string | null;
  listenWanted(): boolean;
  kvSet(key: string, value: string | null): void;
  downloadStart(url: string, destPath: string, title: string, wifiOnly: boolean): number;
  downloadStatus(id: number): DownloadStatus;
  downloadCancel(id: number): void;
  /** Checks the SHA-256 of the finished download and moves it into place; false if it doesn't match. */
  downloadFinish(destPath: string, sha256: string): Promise<boolean>;
  /** Continues a failed download from its partial file with an HTTP Range request. */
  downloadResume(url: string, destPath: string): Promise<boolean>;
  /** Bytes in the partial file so far. */
  downloadPartBytes(destPath: string): number;
  fileExists(path: string): boolean;
  /** iPhone: keeps a file out of iCloud and computer backups (the database). */
  excludeFromBackup?(path: string): boolean;
  /** iPhone: the bundled offline place-name pack (Android reads it from assets). */
  geoPack?(): Uint8Array | null;
  readText(path: string): string | null;
  copyFile(src: string, dst: string): boolean;
  deleteFile(path: string): boolean;
  /**
   * Android: wipes all app data (files, databases, settings, models) like an uninstall, then the
   * system closes the app. False if the system refused. iPhone: wipes the same (and the keychain);
   * the app then restarts its JS.
   */
  wipeAllData?(): boolean;
  exportZip(json: string, files: string[], destPath: string): Promise<string>;
  readBase64(path: string): string | null;
  /** Unpacks a verified .tar.bz2 into destDir and deletes the archive. */
  extractTarBz2(archive: string, destDir: string): Promise<boolean>;
  /** Wake word (sherpa token line + spoken phrase), whether to keep ambient transcripts, and whether JS answers questions. */
  /** Freshest location ≤ 2 h old, or null (no permission / no fix). Also requests a new fix. */
  lastLocation(): DeviceLocation | null;
  hasLocationPermission(): boolean;
  /** Car kit Bluetooth names (regex source, case-insensitive): disconnect marks "parked". */
  placesSetCarPattern?(pattern: string | null): void;
  /** "12 Park Row, Leeds" via Android's Geocoder (usually online); null when unavailable. */
  reverseGeocode?(lat: number, lon: number): Promise<string | null>;
  /** Auto-pause rules as JSON: { quietStart, quietEnd (minutes or -1), places: PausePlace[] }. */
  listenPauseRules(json: string): void;
  /** Why listening is auto-paused right now, or null. */
  listenPauseReason(): string | null;
  /** Saves each kept speech line's audio (Opus) when on; Off the record turns it off. */
  audioSaveEnabled(on: boolean): void;
  listenConfigure(
    wakeKeywords: string,
    wakePhrase: string,
    recordAmbient: boolean,
    jsAnswers: boolean,
  ): void;
  /**
   * Android: instructions-only mode. Speech is transcribed only right after the wake word, in a
   * spoken follow-up, or for push-to-talk; everything else is dropped untranscribed.
   */
  listenCommandsOnly?(on: boolean): void;
  /**
   * Android: the owner's voiceprint centroid (null if not known yet). Only that voice may
   * interrupt a spoken answer (or anyone saying the wake word); kept natively for the service.
   */
  listenSetOwnerVoice?(centroid: number[] | null): void;
  /** Starts the background listening service. Only call while the app is on screen. */
  listenStart(): void;
  listenStop(): void;
  listenActive(): boolean;
  /** Android: starts a spoken answer; pass the id to voiceSay/voiceEnd. */
  voiceBegin(): number;
  /** Android: queues one sentence (Pocket TTS, else the system voice); ignored if stopped since. */
  voiceSay(text: string, answer: number): void;
  /** Android: the answer is complete; the follow-up window opens once it has been heard. */
  voiceEnd(answer: number): void;
  /** Android: stops speaking now. */
  voiceStop(): void;
  /** Android: which voice is in use: "pocket" or "system". */
  voiceEngine(): 'pocket' | 'system';
  /** Android: the voice decided for this phone, its measured speed and the owner's override. */
  voiceInfo(): VoiceInfo;
  /** Android: the owner's voice setting ("auto" = recommended: decided once by speed). */
  voiceSetChoice(choice: 'auto' | 'pocket' | 'system'): void;
  /** Android: speech speed of spoken answers (1 = normal, 0.5–2). */
  voiceSetRate?(rate: number): void;
  /** Android: QR codes and barcodes in a JPEG (ZXing): JSON array of {format, text}. */
  scanCodes?(path: string): Promise<string>;
  /** Android 11+: the system "Save this network?" sheet for a Wi-Fi QR code; false if not shown. */
  wifiAddNetwork?(ssid: string, password: string | null, security: string): boolean;
  /** Android: long-press app icon shortcuts (Ask, Listen, Camera, Remember this). */
  setAppShortcuts?(): boolean;
  /** Android: language answers are spoken in ("" = the phone's); not English uses the system voice. */
  voiceSetLanguage?(tag: string): void;
  /** Stops processing mic audio (e.g. while Sidekick is speaking). */
  setMicPaused(paused: boolean): void;
  pttStart(): void;
  pttStop(): Promise<{ text: string; voice: number[] | null }>;
  speechWarmUp(): Promise<boolean>;
  /** iPhone: asks for Speech Recognition access (on-device only); true when allowed. */
  speechRequestAccess?(): Promise<boolean>;
  /** Parakeet CPU threads (1-8, default 4); reloads speech-to-text if already loaded. */
  speechSetAsrThreads(threads: number): Promise<boolean>;
  /** Android: speech-to-text build folder (v2 English / v3 multilingual); false if not downloaded. */
  speechSetAsrModel?(dir: string): Promise<boolean>;
  /** Android: the phone's language setting as a BCP-47 tag ("de-AT"). */
  phoneLocale?(): string;
  /** Everything heard since the last call (JSON lines), cleared on read. */
  journalDrain(): string[];
  /**
   * Android: up to 500 lines heard since the last ack, kept on the phone until [journalAck] (a kill
   * while saving hands them out again; replayed > 0: some may be saved already).
   */
  journalTake?(): { lines: string[]; replayed: number };
  /** Android: the last [journalTake] is saved. */
  journalAck?(): void;
  /** Android: Sidekick holds the phone's assistant role. */
  assistantIsDefault(): boolean;
  /** Android: opens the system "Digital assistant app" settings. */
  openAssistantSettings(): boolean;
  /** Android 13+: asks to add the Ask Quick Settings tile; false if unsupported. */
  requestAddTile(): boolean;
  /** Android: asks the launcher to pin the Ask/Capture widget; false if unsupported. */
  requestAddWidget(): boolean;
  /** Two-letter country (SIM, network, then language setting), or null. */
  countryCode(): string | null;
  /** Developer check: transcribe a 16 kHz WAV and test it for the wake word. */
  debugTranscribe(wavPath: string): Promise<{ text: string; wake: boolean }>;
  /** Developer check: speak text with the system voice into a WAV file. */
  debugSay(text: string, path: string, voice?: number | null): Promise<string>;
  /** Developer check: voiceprint of a WAV file. */
  debugVoiceprint(wavPath: string): Promise<number[] | null>;
  /** Developer check: offline English system voices, in the order debugSay indexes them. */
  debugVoices(): Promise<string[]>;
  /** Developer check: play a sound file through the speaker; resolves when finished. */
  debugPlay(path: string, delayMs?: number | null): Promise<boolean>;
  /** Normalised text embeddings (EmbeddingGemma 2), [dims] long each. */
  embed(modelPath: string, texts: string[], dims: number): Promise<number[][]>;
  /** Normalised photo embeddings in the same space as [embed] (needs the text+vision model). */
  embedImages(modelPath: string, photoPaths: string[], dims: number): Promise<number[][]>;
  embedUnload(): Promise<void>;
  /** Text lines read from a photo (PP-OCRv6 small, Android), top to bottom, with confidences. */
  ocrPhoto(
    detPath: string,
    recPath: string,
    dictPath: string,
    photoPath: string,
  ): Promise<{ lines: string[]; scores: number[]; ms: number }>;
  ocrUnload(): Promise<void>;
  /** Android: whether this phone can read a PDF's embedded text (else every page needs OCR). */
  pdfCanReadText(): boolean;
  /** Android: a PDF's page count and page [index]'s embedded text (null if unreadable here). */
  pdfPageText(uri: string, index: number): Promise<{ pages: number; text: string | null }>;
  /** Android: page [index] rendered at 1600 px and OCR'd (PP-OCRv6), lines top to bottom. */
  pdfPageOcr(
    uri: string,
    index: number,
    detPath: string,
    recPath: string,
    dictPath: string,
  ): Promise<{ lines: string[]; ms: number }>;
  llmCancel(): void;
  /** Drops the last turn sent with `undoable` from the chat; false when there is none. */
  llmUndoLast(): boolean;
  llmIsLoaded(): boolean;
  llmUnload(): Promise<void>;
  /** Android: whether the user allowed Sidekick's notification listener in system settings. */
  notificationAccessGranted(): boolean;
  /** Android: opens the system screen where notification access is allowed. */
  openNotificationAccessSettings(): void;
  /** Android: keep (true) or ignore (false) new notifications; off by default. */
  notificationsSetCapture(enabled: boolean): void;
  /** Android: notifications kept since the last call (JSON lines), cleared on read. */
  notificationsDrain(): string[];
  /**
   * Android: live camera memory on (needs the camera permission; call while the app is visible).
   * Runs in the listening service; frames are embedded natively and appear in cameraFramesDrain().
   */
  cameraStart(config?: CameraConfig): boolean;
  /** New settings for the running camera (restarts it briefly) or the next start. */
  cameraConfigure(config?: CameraConfig): void;
  cameraStop(): void;
  /** Pause / resume filming without stopping the service (the notification has the same buttons). */
  cameraPause(paused: boolean): void;
  cameraStatus(): CameraStatus;
  /** Hold (true) frame embedding while answering; frames are still saved and embedded after. */
  cameraHold(hold: boolean): void;
  /** Embedded keyframes since the last call (JSON lines, see FrameJournalEntry), cleared on read. */
  cameraFramesDrain(max?: number | null): string[];
  /** The newest [n] frames, oldest first (live while the camera runs, else recent keyframes). */
  cameraLatestFrames(n: number): FrameRef[];
  /** Finished video files overlapping the window, each with where to start and how long. */
  cameraVideoBetween(fromMs: number, toMs: number): Promise<VideoSlice[]>;
  /** Up to [n] keyframes [spacingMs] apart around [atMs], oldest first. */
  cameraFramesAround(atMs: number, n: number, spacingMs: number): Promise<FrameRef[]>;
  /** Camera storage per kind, plus free / total / reserve bytes. */
  cameraStorageUsage(): Promise<CameraStorage>;
  /** Heat, battery and memory right now. */
  deviceState(): DeviceState;
  /** Android: connected USB (UVC) cameras. */
  usbCameraList(): { name: string; permission: boolean }[];
  /** Android: use the first USB camera (asks permission; needs CAMERA granted). False if none. */
  usbCameraOpen(width: number, height: number, fps: number): boolean;
  /** Android: back to the phone camera, and don't reopen the USB camera on plug-in. */
  usbCameraUsePhone(): void;
  /** Android: the USB camera mode in use, or null. */
  usbCameraMode(): { width: number; height: number; fps: number; mjpeg: boolean } | null;
  /** Android: audio inputs/outputs and which are in use. */
  audioDevices(): AudioDevices;
  /** Android: headphones (wired / Bluetooth / USB headset) are connected. */
  headphonesOn(): boolean;
  /** Android: pin an input/output by key (null = recommended). */
  audioSetOverride(input: string | null, output: string | null): void;
  /** Android: a button-press ask started/ended (allows the Bluetooth headset mic meanwhile). */
  audioSetAsking(on: boolean): void;
  /** Android: can two mics record at once (headset + USB camera)? Run with Listen off. */
  audioProbeSplit(): Promise<SplitAudioProbe>;
  /** Android: receive the headset / Bluetooth button (walk mode). */
  mediaButtonsEnable(on: boolean): void;
}

const native = requireNativeModule<SidekickNativeModule>('SidekickNative');

/** On iPhone, Android-only calls answer "not available" instead of throwing (ios-fallbacks.ts). */
export default Platform.OS === 'ios' ? withIosFallbacks(native) : native;

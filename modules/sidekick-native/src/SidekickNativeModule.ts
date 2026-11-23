import { NativeModule, requireNativeModule } from 'expo';

import type {
  DeviceInfo,
  DownloadStatus,
  GenerateOptions,
  LlmCandidate,
  LlmLoadResult,
  LlmStats,
  SidekickNativeModuleEvents,
} from './SidekickNative.types';

declare class SidekickNativeModule extends NativeModule<SidekickNativeModuleEvents> {
  getDeviceInfo(): DeviceInfo;
  llmLoad(candidates: LlmCandidate[]): Promise<LlmLoadResult>;
  llmGenerate(
    requestId: string,
    prompt: string,
    imagePath: string | null,
    opts?: GenerateOptions,
  ): Promise<LlmStats>;
  /** Small persistent settings (not for secrets). */
  kvGet(key: string): string | null;
  kvSet(key: string, value: string | null): void;
  downloadStart(url: string, destPath: string, title: string, wifiOnly: boolean): number;
  downloadStatus(id: number): DownloadStatus;
  downloadCancel(id: number): void;
  /** Checks the SHA-256 of the finished download and moves it into place; false if it doesn't match. */
  downloadFinish(destPath: string, sha256: string): Promise<boolean>;
  fileExists(path: string): boolean;
  readText(path: string): string | null;
  copyFile(src: string, dst: string): boolean;
  deleteFile(path: string): boolean;
  exportZip(json: string, files: string[], destPath: string): Promise<string>;
  readBase64(path: string): string | null;
  /** Unpacks a verified .tar.bz2 into destDir and deletes the archive. */
  extractTarBz2(archive: string, destDir: string): Promise<boolean>;
  /** Wake word (sherpa token line + spoken phrase), whether to keep ambient transcripts, and whether JS answers questions. */
  listenConfigure(
    wakeKeywords: string,
    wakePhrase: string,
    recordAmbient: boolean,
    jsAnswers: boolean,
  ): void;
  /** Starts the background listening service. Only call while the app is on screen. */
  listenStart(): void;
  listenStop(): void;
  listenActive(): boolean;
  /** Stops processing mic audio (e.g. while Sidekick is speaking). */
  setMicPaused(paused: boolean): void;
  pttStart(): void;
  pttStop(): Promise<{ text: string; voice: number[] | null }>;
  speechWarmUp(): Promise<boolean>;
  /** Everything heard since the last call (JSON lines), cleared on read. */
  journalDrain(): string[];
  /** Developer check: transcribe a 16 kHz WAV and test it for the wake word. */
  debugTranscribe(wavPath: string): Promise<{ text: string; wake: boolean }>;
  /** Developer check: speak text with the system voice into a WAV file. */
  debugSay(text: string, path: string, voice?: number | null): Promise<string>;
  /** Developer check: play a sound file through the speaker; resolves when finished. */
  debugPlay(path: string, delayMs?: number | null): Promise<boolean>;
  /** Normalised text embeddings (EmbeddingGemma 2), [dims] long each. */
  embed(modelPath: string, texts: string[], dims: number): Promise<number[][]>;
  embedUnload(): Promise<void>;
  llmCancel(): void;
  llmIsLoaded(): boolean;
  llmUnload(): Promise<void>;
}

export default requireNativeModule<SidekickNativeModule>('SidekickNative');

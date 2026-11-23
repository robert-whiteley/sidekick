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
  llmCancel(): void;
  llmUnload(): Promise<void>;
}

export default requireNativeModule<SidekickNativeModule>('SidekickNative');

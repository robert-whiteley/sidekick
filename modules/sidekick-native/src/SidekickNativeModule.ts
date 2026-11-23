import { NativeModule, requireNativeModule } from 'expo';

import type {
  DeviceInfo,
  LlmCandidate,
  LlmLoadResult,
  LlmStats,
  SidekickNativeModuleEvents,
} from './SidekickNative.types';

declare class SidekickNativeModule extends NativeModule<SidekickNativeModuleEvents> {
  getDeviceInfo(): DeviceInfo;
  llmLoad(candidates: LlmCandidate[]): Promise<LlmLoadResult>;
  llmGenerate(requestId: string, prompt: string, imagePath: string | null): Promise<LlmStats>;
  llmCancel(): void;
  llmUnload(): Promise<void>;
}

export default requireNativeModule<SidekickNativeModule>('SidekickNative');

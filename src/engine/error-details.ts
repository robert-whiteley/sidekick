/** "Copy error details" on this phone: error-details-logic.ts with the app's and phone's versions. */
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { errorDetails, type ErrorEnv } from './error-details-logic';
import { llmCandidates } from './llm-candidates';
import { modelsDir } from './paths';

function env(): ErrorEnv {
  let device = 'unknown';
  let ramMb = 0;
  let chatModel = 'unknown';
  let modelLoaded = false;
  try {
    const info = SidekickNative.getDeviceInfo();
    device = info.model;
    ramMb = info.totalRamMb;
    chatModel = llmCandidates(info.soc, modelsDir())[0]?.modelPath.split('/').pop() ?? 'none';
    modelLoaded = SidekickNative.llmIsLoaded();
  } catch {
    // Reported as unknown.
  }
  return {
    app: Application.nativeApplicationVersion ?? '?',
    build: Application.nativeBuildVersion ?? '?',
    os: Platform.OS === 'ios' ? 'iOS' : Platform.OS,
    osVersion: String(Platform.Version),
    device,
    ramMb,
    chatModel,
    modelLoaded,
  };
}

/** The text "Copy error details" puts on the clipboard for [error] that happened in [where]. */
export function errorDetailsFor(where: string, error: unknown): string {
  return errorDetails(where, error, env());
}

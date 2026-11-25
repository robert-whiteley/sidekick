import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { startFocusWatches } from './focus-watch';
import { applySpeechRate } from './voice-commands';

/**
 * Start-up for camera watches (saved ones carry on), the speech speed and the long-press app icon
 * shortcuts (Ask, Listen, Camera, Remember this). Returns a stop function (nothing to stop).
 */
export function startWave2(): () => void {
  if (Platform.OS !== 'android') return () => {};
  try {
    startFocusWatches();
    applySpeechRate();
    SidekickNative.setAppShortcuts?.();
  } catch (e) {
    console.log(`[start] watches/shortcuts: ${String(e)}`);
  }
  return () => {};
}

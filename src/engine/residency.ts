/** The phone's answers for residency-logic.ts. */
import SidekickNative from '../../modules/sidekick-native';
import { embedderEvictsChat as evicts, type ResidencyState } from './residency-logic';

function state(): ResidencyState {
  return {
    nativeAlone: SidekickNative.modelsMustBeAlone?.(),
    totalRamMb: SidekickNative.getDeviceInfo().totalRamMb,
    llmLoaded: SidekickNative.llmIsLoaded(),
  };
}

/** Whether loading the memory-search model now would unload the chat model (false if unknown). */
export function embedderEvictsChat(): boolean {
  try {
    return evicts(state());
  } catch {
    return false;
  }
}

import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import SidekickNative from '../../modules/sidekick-native';
import { isDownloaded } from '@/engine/downloads';
import { allRequiredFiles } from '@/engine/llm-candidates';
import { OBSOLETE_MODEL_PATHS } from '@/engine/models';
import { modelsDir } from '@/engine/paths';
import { AskScreen } from '@/features/ask/AskScreen';
import { ModelSetup } from '@/features/ask/ModelSetup';

function modelsReady() {
  const ready = allRequiredFiles(SidekickNative.getDeviceInfo().soc).every(isDownloaded);
  // Once the current models are in place, free the space used by ones earlier versions fetched.
  if (ready) {
    for (const p of OBSOLETE_MODEL_PATHS) SidekickNative.deleteFile(`${modelsDir()}/${p}`);
  }
  return ready;
}

export default function HomeScreen() {
  const [ready, setReady] = useState(modelsReady);
  if (ready) return <AskScreen />;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ModelSetup onReady={() => setReady(true)} />
    </SafeAreaView>
  );
}

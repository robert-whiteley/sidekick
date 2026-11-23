import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import SidekickNative from '../../modules/sidekick-native';
import { isDownloaded } from '@/engine/downloads';
import { allRequiredFiles } from '@/engine/llm-candidates';
import { AskScreen } from '@/features/ask/AskScreen';
import { ModelSetup } from '@/features/ask/ModelSetup';

function modelsReady() {
  return allRequiredFiles(SidekickNative.getDeviceInfo().soc).every(isDownloaded);
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

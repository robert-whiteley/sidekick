import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import SidekickNative from '../../modules/sidekick-native';
import { isDownloaded } from '@/engine/downloads';
import { parseEntry } from '@/engine/entry-points';
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
  // sidekick://?entry=listen|capture|screen from the tile, widget or phone assistant.
  const entry = parseEntry(useLocalSearchParams());
  // Cleared once handled, so the same link (e.g. a widget button) works again next time.
  const entryDone = useCallback(() => router.setParams({ entry: undefined, t: undefined }), []);
  if (ready) return <AskScreen entry={entry} onEntryHandled={entryDone} />;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ModelSetup onReady={() => setReady(true)} />
    </SafeAreaView>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import SidekickNative from '../../modules/sidekick-native';
import { isDownloaded } from '@/engine/downloads';
import { parseEntry } from '@/engine/entry-points';
import { allRequiredFiles } from '@/engine/llm-candidates';
import { OBSOLETE_MODEL_PATHS } from '@/engine/models';
import { modelsDir } from '@/engine/paths';
import { AskScreen } from '@/features/ask/AskScreen';
import { onLlmLoaded } from '@/engine/llm';
import { noteLlmLoaded, startModelUpdates } from '@/engine/model-updates';
import { startStorageMonitor } from '@/engine/storage-monitor';
import { FirstRun } from '@/features/onboarding/FirstRun';

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
  // Model updates (Automatic / Ask me / Off) and storage cleanup run once the models are in.
  useEffect(() => {
    if (!ready) return;
    const stops = [onLlmLoaded(noteLlmLoaded), startModelUpdates(), startStorageMonitor()];
    return () => stops.forEach((s) => s());
  }, [ready]);
  if (ready) return <AskScreen entry={entry} onEntryHandled={entryDone} />;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <FirstRun onReady={() => setReady(true)} />
    </SafeAreaView>
  );
}

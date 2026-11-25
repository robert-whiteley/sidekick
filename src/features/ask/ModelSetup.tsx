import { useState } from 'react';
import { View } from 'react-native';

import SidekickNative from '../../../modules/sidekick-native';
import { downloadFile, isDownloaded } from '@/engine/downloads';
import { allRequiredFiles } from '@/engine/llm-candidates';
import { AppText, Button, makeStyles, ProgressBar, radius, space } from '@/ui';

/** First run: fetch the AI model once. After this Sidekick never needs the internet. */
export function ModelSetup({ onReady }: { onReady: () => void }) {
  const files = allRequiredFiles(SidekickNative.getDeviceInfo().soc).filter(
    (f) => !isDownloaded(f),
  );
  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  const size =
    bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  const [status, setStatus] = useState('');
  const [fraction, setFraction] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      for (const [i, f] of files.entries()) {
        await downloadFile(f, (t, fr) => {
          setStatus(files.length > 1 ? `File ${i + 1} of ${files.length}: ${t}` : t);
          setFraction(fr);
        });
      }
      onReady();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const styles = useStyles();
  return (
    <View style={styles.card}>
      <AppText variant="title">One-time setup</AppText>
      <AppText>
        Sidekick needs its AI models ({size}). It downloads once over the internet; after that
        everything runs on this phone and nothing you say or see leaves it. Wi-Fi recommended.
      </AppText>
      {busy ? (
        <>
          <ProgressBar fraction={fraction} label="Download progress" />
          <AppText>{status || 'Starting…'}</AppText>
        </>
      ) : (
        <Button title="Download" variant="filled" block onPress={() => void start()} />
      )}
      {error ? <AppText tone="danger">{error}</AppText> : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: {
    margin: space.xl,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: c.surface,
    gap: space.md,
  },
}));

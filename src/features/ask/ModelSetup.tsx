import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import SidekickNative from '../../../modules/sidekick-native';
import { downloadFile, isDownloaded } from '@/engine/downloads';
import { allRequiredFiles } from '@/engine/llm-candidates';

/** First run: fetch the AI model once. After this Sidekick never needs the internet. */
export function ModelSetup({ onReady }: { onReady: () => void }) {
  const files = allRequiredFiles(SidekickNative.getDeviceInfo().soc).filter(
    (f) => !isDownloaded(f),
  );
  const gb = (files.reduce((n, f) => n + f.bytes, 0) / 1e9).toFixed(1);
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

  return (
    <View style={styles.card}>
      <Text style={styles.title}>One-time setup</Text>
      <Text style={styles.body}>
        Sidekick needs its AI models ({gb} GB). It downloads once over the internet; after that
        everything runs on this phone and nothing you say or see leaves it. Wi-Fi recommended.
      </Text>
      {busy ? (
        <>
          <View style={styles.bar}>
            <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
          </View>
          <Text style={styles.body}>{status || 'Starting…'}</Text>
        </>
      ) : (
        <Pressable style={styles.button} onPress={start} accessibilityRole="button">
          <Text style={styles.buttonText}>Download model</Text>
        </Pressable>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { margin: 20, padding: 20, borderRadius: 16, backgroundColor: '#f2f2f5', gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#ddd', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: '#2f6fed' },
  button: { backgroundColor: '#2f6fed', padding: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: 'white', fontSize: 17, fontWeight: '600' },
  error: { color: '#b00020', fontSize: 15 },
});

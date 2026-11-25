import { addNetworkStateListener } from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import SidekickNative from '../../../modules/sidekick-native';
import {
  allowMobileDataOnce,
  connection,
  DownloadCancelled,
  downloadAll,
  formatTimeLeft,
  isDownloaded,
  type Progress,
} from '@/engine/downloads';
import { allRequiredFiles } from '@/engine/llm-candidates';
import { getSettings } from '@/engine/settings';
import { formatBytes, spaceNeeded } from '@/engine/storage';
import { diskSpace, reserveBytes } from '@/engine/storage-monitor';
import { markFirstRunDone, runSpeedCheck } from './after-setup';
import { EXPLAINER, firstRunStep, type FirstRunStep } from './first-run';

/** Opens the phone's storage settings (Android), else the app's settings. */
export function openStorageSettings() {
  if (Platform.OS === 'android') {
    Linking.sendIntent('android.settings.INTERNAL_STORAGE_SETTINGS').catch(() =>
      Linking.openSettings(),
    );
  } else {
    void Linking.openSettings();
  }
}

/**
 * First run: nothing to tap. Checks space, downloads the models in the background (the system
 * download carries on with the app closed), explains Sidekick meanwhile, then opens the chat.
 */
export function FirstRun({ onReady }: { onReady: () => void }) {
  const [step, setStep] = useState<FirstRunStep | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const mobileAllowed = useRef(false);
  const waitChosen = useRef(false);
  const gotBytes = useRef(0);
  const running = useRef<{ wifiOnly: boolean; stop: boolean } | null>(null);

  const [files] = useState(() =>
    allRequiredFiles(SidekickNative.getDeviceInfo().soc).filter((f) => !isDownloaded(f)),
  );
  const total = files.reduce((n, f) => n + f.bytes, 0);

  const start = useCallback(
    (wifiOnly: boolean) => {
      // Already downloading the same way: nothing to do. Switching (Wi-Fi only -> any network)
      // stops the queued jobs and starts them again allowing mobile data.
      if (running.current && running.current.wifiOnly === wifiOnly) return;
      if (running.current) running.current.stop = true;
      const run = { wifiOnly, stop: false };
      running.current = run;
      setError('');
      const onProgress = (p: Progress) => {
        gotBytes.current = p.bytes;
        setProgress(p);
      };
      downloadAll(files, onProgress, wifiOnly, () => run.stop).then(
        () => {
          if (run.stop) return;
          markFirstRunDone();
          void runSpeedCheck();
          onReady();
        },
        (e) => {
          if (e instanceof DownloadCancelled || run.stop) return;
          running.current = null;
          setError(e instanceof Error ? e.message : String(e));
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const decide = useCallback(async () => {
    const { free, total: diskTotal } = diskSpace();
    const net = await connection();
    const s = firstRunStep({
      // What is already downloaded (partly) doesn't need the space again.
      neededBytes: spaceNeeded(files) - gotBytes.current,
      freeBytes: free,
      reserveBytes: reserveBytes(diskTotal),
      wifi: net.wifi,
      mobilePref: waitChosen.current ? 'off' : (getSettings().mobileDataDownloads ?? 'ask'),
      mobileAllowed: mobileAllowed.current,
    });
    setStep(s);
    if (s.step !== 'short-space') start(s.wifiOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  useEffect(() => {
    void decide();
    const app = AppState.addEventListener('change', (st) => st === 'active' && void decide());
    const net = addNetworkStateListener(() => void decide());
    return () => {
      app.remove();
      net.remove();
    };
  }, [decide]);

  const fraction = progress && progress.total > 0 ? progress.bytes / progress.total : 0;
  const status = !progress
    ? 'Starting…'
    : progress.text && fraction >= 0.999
      ? progress.text
      : progress.waiting
        ? step?.step === 'ask-mobile' || (step?.step === 'download' && step.wifiOnly)
          ? 'Waiting for Wi-Fi…'
          : 'Waiting for an internet connection…'
        : formatTimeLeft(progress.secondsLeft);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Getting Sidekick ready</Text>
      <Text style={styles.lead}>
        A one-time download of {formatBytes(total)}. You can leave the app; it carries on by itself.
      </Text>

      {step?.step === 'short-space' ? (
        <View style={styles.card}>
          <Text style={styles.cardText}>
            Sidekick needs {formatBytes(step.shortBy)} more free space on this phone (it always
            leaves some free for the phone itself).
          </Text>
          <Pressable style={styles.button} onPress={openStorageSettings} accessibilityRole="button">
            <Text style={styles.buttonText}>Open storage settings</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.progress}>
          <View style={styles.bar}>
            <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
          </View>
          <Text style={styles.status}>
            {Math.floor(fraction * 100)}% · {status}
          </Text>
        </View>
      )}

      {step?.step === 'ask-mobile' ? (
        <View style={styles.card}>
          <Text style={styles.cardText}>
            Download {formatBytes(Math.max(0, total - (progress?.bytes ?? 0)))} now on mobile data,
            or wait for Wi-Fi?
          </Text>
          <View style={styles.row}>
            <Pressable
              style={[styles.button, styles.flex]}
              onPress={() => {
                waitChosen.current = true;
                setStep({ step: 'download', wifiOnly: true });
              }}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Wait for Wi-Fi</Text>
            </Pressable>
            <Pressable
              style={[styles.buttonQuiet, styles.flex]}
              onPress={() => {
                mobileAllowed.current = true;
                allowMobileDataOnce();
                void decide();
              }}
              accessibilityRole="button"
            >
              <Text style={styles.buttonQuietText}>Download now</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.button} onPress={() => void decide()} accessibilityRole="button">
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <Explainer />
    </ScrollView>
  );
}

/** What Sidekick is, in plain words (also shown from Settings → About). */
export function Explainer() {
  return (
    <View style={styles.explainer}>
      {EXPLAINER.map((s) => (
        <View key={s.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{s.title}</Text>
          <Text style={styles.sectionBody}>{s.body}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  lead: { fontSize: 16, lineHeight: 22, color: '#444' },
  progress: { gap: 8 },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#e3e3e8', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: '#2f6fed' },
  status: { fontSize: 15, color: '#555' },
  card: { padding: 16, borderRadius: 16, backgroundColor: '#f2f2f5', gap: 12 },
  cardText: { fontSize: 16, lineHeight: 22 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  button: { backgroundColor: '#2f6fed', padding: 14, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  buttonQuiet: { backgroundColor: '#e3e3e8', padding: 14, borderRadius: 12, alignItems: 'center' },
  buttonQuietText: { color: '#222', fontSize: 16, fontWeight: '600' },
  error: { color: '#b00020', fontSize: 15 },
  explainer: { gap: 18, marginTop: 12 },
  section: { gap: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '600' },
  sectionBody: { fontSize: 16, lineHeight: 22, color: '#333' },
});

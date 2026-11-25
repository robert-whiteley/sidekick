import { addNetworkStateListener } from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';

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
import { AppText, Button, Card, makeStyles, ProgressBar, space } from '@/ui';
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
    const { free } = diskSpace();
    const net = await connection();
    const s = firstRunStep({
      // What is already downloaded (partly) doesn't need the space again.
      neededBytes: spaceNeeded(files) - gotBytes.current,
      freeBytes: free,
      reserveBytes: reserveBytes(),
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

  const bg = useBg().bg;
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
    <ScrollView style={bg} contentContainerStyle={styles.page}>
      <AppText variant="headline">Getting Sidekick ready</AppText>
      <AppText tone="muted">
        A one-time download of {formatBytes(total)}. You can leave the app; it carries on by itself.
      </AppText>

      {step?.step === 'short-space' ? (
        <Card>
          <AppText>
            Sidekick needs {formatBytes(step.shortBy)} more free space on this phone (it always
            leaves some free for the phone itself).
          </AppText>
          <Button
            title="Open storage settings"
            variant="filled"
            block
            onPress={openStorageSettings}
          />
        </Card>
      ) : (
        <View style={styles.progress}>
          <ProgressBar fraction={fraction} label="Download progress" />
          <AppText variant="bodySmall" tone="muted">
            {Math.floor(fraction * 100)}% · {status}
          </AppText>
        </View>
      )}

      {step?.step === 'ask-mobile' ? (
        <Card>
          <AppText>
            Download {formatBytes(Math.max(0, total - (progress?.bytes ?? 0)))} now on mobile data,
            or wait for Wi-Fi?
          </AppText>
          <View style={styles.row}>
            <Button
              title="Wait for Wi-Fi"
              variant="filled"
              style={styles.flex}
              onPress={() => {
                waitChosen.current = true;
                setStep({ step: 'download', wifiOnly: true });
              }}
            />
            <Button
              title="Download now"
              variant="tonal"
              style={styles.flex}
              onPress={() => {
                mobileAllowed.current = true;
                allowMobileDataOnce();
                void decide();
              }}
            />
          </View>
        </Card>
      ) : null}

      {error ? (
        <Card tone="danger">
          <AppText tone="danger">{error}</AppText>
          <Button title="Try again" variant="filled" block onPress={() => void decide()} />
        </Card>
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
          <AppText variant="bodyStrong">{s.title}</AppText>
          <AppText tone="muted">{s.body}</AppText>
        </View>
      ))}
    </View>
  );
}

const useBg = makeStyles((c) => ({ bg: { backgroundColor: c.bg } }));

const styles = StyleSheet.create({
  page: { padding: space.xl, gap: space.lg },
  progress: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  explainer: { gap: space.lg, marginTop: space.md },
  section: { gap: space.xs },
});

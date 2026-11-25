import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AUDIO_KEEP_OPTIONS, RESERVE_OPTIONS, VIDEO_KEEP_OPTIONS } from '@/engine/device-profile';
import { updateSettings } from '@/engine/settings';
import { formatBytes, KIND_LABELS, recommendedKeep, type StorageKind } from '@/engine/storage';
import {
  checkStorage,
  measureUsageNow,
  setStillsKeepDays,
  stillsKeepDays,
  type StorageReport,
} from '@/engine/storage-monitor';
import { daysLabel, hoursLabel } from '@/features/settings/choice-logic';
import { useSettings } from '@/features/settings/useSettings';
import { AppText, chart, ChoiceRow, makeStyles, Page, radius, Section, space } from '@/ui';

const KINDS: StorageKind[] = ['video', 'stills', 'photos', 'audio', 'text', 'models'];
const COLORS = Object.fromEntries(KINDS.map((k, i) => [k, chart[i]])) as Record<
  StorageKind,
  string
>;

function days(d: number) {
  return d >= 36500 ? 'Forever' : daysLabel(d);
}

/** Storage: what uses space, the forecast, and how long things are kept. */
export function StorageScreen() {
  const [report, setReport] = useState<StorageReport>(() => checkStorage());
  const refresh = useCallback(() => setReport(checkStorage()), []);
  // The camera recorder's exact sizes (includes files still being written).
  useEffect(() => {
    let live = true;
    void measureUsageNow().then((usage) => live && setReport((r) => ({ ...r, usage })));
    return () => {
      live = false;
    };
  }, [report.cleaned, report.keep]);

  // The same Recommended values and choices as Settings › Camera & audio and › Advanced.
  const { s, rec } = useSettings();
  const stillsRec = recommendedKeep(report.total).stillsKeepDays;
  const used = KINDS.reduce((n, k) => n + report.usage[k], 0);
  const st = useStyles();

  const rows: {
    title: string;
    current: number | null;
    recommended: number;
    fmt: (n: number) => string;
    options: number[];
    set: (v: number | null) => void;
  }[] = [
    {
      title: 'Keep video for',
      current: s.videoKeepHours ?? null,
      recommended: rec.videoKeepHours,
      fmt: hoursLabel,
      options: VIDEO_KEEP_OPTIONS,
      set: (v) => updateSettings({ videoKeepHours: v }),
    },
    {
      title: 'Keep camera stills for',
      current: stillsKeepDays(),
      recommended: stillsRec,
      fmt: days,
      options: [30, 90, 365, 36500],
      set: setStillsKeepDays,
    },
    {
      title: 'Keep conversation audio for',
      current: s.audioKeepDays ?? null,
      recommended: rec.audioKeepDays,
      fmt: days,
      options: AUDIO_KEEP_OPTIONS,
      set: (v) => updateSettings({ audioKeepDays: v }),
    },
    {
      title: 'Always leave free for the phone',
      current: s.storageReserveGB ?? null,
      recommended: rec.storageReserveGB,
      fmt: (g) => `${g} GB`,
      options: RESERVE_OPTIONS,
      set: (v) => updateSettings({ storageReserveGB: v }),
    },
  ];

  return (
    <Page title="Storage">
      <AppText variant="titleSmall">
        Sidekick uses {formatBytes(used)} · {formatBytes(report.free)} free on the phone
      </AppText>
      <View style={st.bar} accessibilityLabel="Storage used by kind">
        {KINDS.map((k) => (
          <View
            key={k}
            style={{
              width: `${report.total > 0 ? (report.usage[k] / report.total) * 100 : 0}%`,
              backgroundColor: COLORS[k],
            }}
          />
        ))}
      </View>
      {KINDS.map((k) => (
        <View key={k} style={styles.kind}>
          <View style={[styles.dot, { backgroundColor: COLORS[k] }]} />
          <AppText style={styles.flex}>{KIND_LABELS[k]}</AppText>
          <AppText tone="muted">{formatBytes(report.usage[k])}</AppText>
        </View>
      ))}
      <AppText variant="bodySmall" tone="muted">
        Text and the memory index are kept for good.
      </AppText>

      <Section title="Forecast">
        <AppText>{report.forecast.text}</AppText>
        {report.cleaned > 0 ? (
          <AppText variant="bodySmall" tone="muted">
            Just freed {formatBytes(report.cleaned)} of old media.
          </AppText>
        ) : null}
      </Section>

      <Section title="Keep periods">
        {rows.map((r) => (
          <ChoiceRow<number>
            key={r.title}
            label={r.title}
            options={r.options.map((o) => ({ value: o, label: r.fmt(o) }))}
            value={r.current}
            recommended={r.recommended}
            format={r.fmt}
            onChange={(v) => {
              r.set(v);
              refresh();
            }}
          />
        ))}
      </Section>
      <AppText variant="bodySmall" tone="muted">
        When space runs low, the oldest video goes first, then camera stills past their keep period.
        Text, memories and photos you asked about are never deleted without asking.
      </AppText>
    </Page>
  );
}

const useStyles = makeStyles((c) => ({
  bar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: c.surfaceHigh,
    marginVertical: space.sm,
  },
}));

const styles = StyleSheet.create({
  kind: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 12, height: 12, borderRadius: 6 },
  flex: { flex: 1 },
});

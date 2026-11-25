import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getSettings, updateSettings } from '@/engine/settings';
import {
  formatBytes,
  KIND_LABELS,
  recommendedKeep,
  recommendedReserve,
  type StorageKind,
} from '@/engine/storage';
import {
  checkStorage,
  measureUsageNow,
  setStillsKeepDays,
  stillsKeepDays,
  type StorageReport,
} from '@/engine/storage-monitor';

const KINDS: StorageKind[] = ['video', 'stills', 'photos', 'audio', 'text', 'models'];
const COLORS: Record<StorageKind, string> = {
  video: '#2f6fed',
  stills: '#5b8def',
  photos: '#8a63d2',
  audio: '#e07a2f',
  text: '#2f9e6e',
  models: '#9aa0a6',
};

type Option = { label: string; value: number | null };

function hours(h: number) {
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} days`;
}
function days(d: number) {
  if (d === 0 || d >= 36500) return 'Forever';
  return d >= 365 ? `${Math.round(d / 365)} year${d >= 730 ? 's' : ''}` : `${d} days`;
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

  const rec = recommendedKeep(report.total);
  const s = getSettings();
  const used = KINDS.reduce((n, k) => n + report.usage[k], 0);

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
      fmt: hours,
      options: [2, 8, 24, 72, 168],
      set: (v) => updateSettings({ videoKeepHours: v }),
    },
    {
      title: 'Keep camera stills for',
      current: stillsKeepDays(),
      recommended: rec.stillsKeepDays,
      fmt: days,
      options: [30, 90, 365, 36500],
      set: setStillsKeepDays,
    },
    {
      title: 'Keep conversation audio for',
      current: s.audioKeepDays ?? null,
      recommended: rec.audioKeepDays,
      fmt: days,
      options: [7, 30, 90, 365, 0],
      set: (v) => updateSettings({ audioKeepDays: v }),
    },
    {
      title: 'Always leave free for the phone',
      current: s.storageReserveGB ?? null,
      recommended: Math.round(recommendedReserve(report.total) / 1e9),
      fmt: (g) => `${g} GB`,
      options: [2, 5, 10, 20],
      set: (v) => updateSettings({ storageReserveGB: v }),
    },
  ];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.big}>
        Sidekick uses {formatBytes(used)} · {formatBytes(report.free)} free on the phone
      </Text>
      <View style={styles.bar} accessibilityLabel="Storage used by kind">
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
          <Text style={styles.kindLabel}>{KIND_LABELS[k]}</Text>
          <Text style={styles.kindSize}>{formatBytes(report.usage[k])}</Text>
        </View>
      ))}
      <Text style={styles.note}>Text and the memory index are kept for good.</Text>

      <Text style={styles.heading}>Forecast</Text>
      <Text style={styles.body}>{report.forecast.text}</Text>
      {report.cleaned > 0 ? (
        <Text style={styles.muted}>Just freed {formatBytes(report.cleaned)} of old media.</Text>
      ) : null}

      {rows.map((r) => {
        const opts: Option[] = [
          { label: `Recommended (${r.fmt(r.recommended)})`, value: null },
          ...r.options
            .filter((o) => o !== r.recommended)
            .map((o) => ({ label: r.fmt(o), value: o })),
        ];
        return (
          <View key={r.title} style={styles.setting}>
            <Text style={styles.heading}>{r.title}</Text>
            <View style={styles.chips}>
              {opts.map((o) => {
                const on = r.current === o.value;
                return (
                  <Pressable
                    key={o.label}
                    onPress={() => {
                      r.set(o.value);
                      refresh();
                    }}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      <Text style={styles.note}>
        When space runs low, the oldest video goes first, then camera stills past their keep period.
        Text, memories and photos you asked about are never deleted without asking.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 10 },
  big: { fontSize: 18, fontWeight: '600' },
  bar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: '#e3e3e8',
    marginVertical: 6,
  },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  kindLabel: { flex: 1, fontSize: 16 },
  kindSize: { fontSize: 16, color: '#555' },
  heading: { fontSize: 17, fontWeight: '600', marginTop: 14 },
  body: { fontSize: 16, lineHeight: 22 },
  muted: { fontSize: 15, color: '#666', padding: 20 },
  note: { fontSize: 14, color: '#666', lineHeight: 20 },
  setting: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: '#eef0f4' },
  chipOn: { backgroundColor: '#2f6fed' },
  chipText: { fontSize: 15, color: '#222' },
  chipTextOn: { color: 'white', fontWeight: '600' },
});

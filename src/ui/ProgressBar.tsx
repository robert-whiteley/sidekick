import { StyleSheet, View } from 'react-native';

import { useColors } from './theme';

/** A determinate progress bar (downloads, storage used). fraction 0–1. */
export function ProgressBar({ fraction, label }: { fraction: number; label?: string }) {
  const c = useColors();
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View
      style={[styles.bar, { backgroundColor: c.surfaceHigh }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
    >
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: c.primary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8 },
});

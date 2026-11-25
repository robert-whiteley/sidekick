import { useRef, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { AppText } from './Text';
import { useColors } from './theme';
import { space, TOUCH } from './tokens';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Snaps [v] to the step grid starting at [min]. */
export function snap(v: number, min: number, max: number, step: number): number {
  const n = Math.round((v - min) / step) * step + min;
  return clamp(Math.round(n * 1e6) / 1e6, min, max);
}

/**
 * A continuous setting (one slider look on Android and iOS): title with the live value, the Recommended value
 * marked on the track, and "Reset to Recommended". value null = following Recommended.
 * Screen readers adjust it with swipe up/down (increment/decrement actions).
 */
export function SliderRow(props: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number | null;
  recommended: number;
  format: (v: number) => string;
  onChange: (v: number | null) => void;
}) {
  const c = useColors();
  const { min, max, step, recommended } = props;
  const committed = props.value ?? recommended;
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? committed;
  // Gesture state for the touch handlers (never read during render).
  const g = useRef({ width: 1, startX: 0, startPage: 0 });
  const valueAt = (x: number) =>
    snap(min + (clamp(x, 0, g.current.width) / g.current.width) * (max - min), min, max, step);
  const xOf = (e: GestureResponderEvent) =>
    g.current.startX + e.nativeEvent.pageX - g.current.startPage;
  const touch = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => {
      g.current.startX = e.nativeEvent.locationX;
      g.current.startPage = e.nativeEvent.pageX;
      setDrag(valueAt(g.current.startX));
    },
    onResponderMove: (e: GestureResponderEvent) => setDrag(valueAt(xOf(e))),
    onResponderRelease: (e: GestureResponderEvent) => {
      const v = valueAt(xOf(e));
      setDrag(null);
      commit(v);
    },
    onResponderTerminate: () => setDrag(null),
  };
  const commit = (v: number) => props.onChange(v === recommended ? null : v);
  const frac = (v: number) => (v - min) / (max - min);
  const atRec = shown === recommended;
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppText variant="body" style={styles.flex}>
          {props.label}
        </AppText>
        <AppText variant="label" tone="primary">
          {props.format(shown)}
          {atRec ? ' (Recommended)' : ''}
        </AppText>
      </View>
      <View
        style={styles.track}
        onLayout={(e: LayoutChangeEvent) =>
          (g.current.width = Math.max(1, e.nativeEvent.layout.width))
        }
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={props.label}
        accessibilityValue={{ text: props.format(shown) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          commit(
            snap(
              committed + (e.nativeEvent.actionName === 'increment' ? step : -step),
              min,
              max,
              step,
            ),
          )
        }
        {...touch}
      >
        <View pointerEvents="none" style={[styles.rail, { backgroundColor: c.surfaceHigh }]} />
        <View
          pointerEvents="none"
          style={[
            styles.rail,
            styles.fill,
            { width: `${frac(shown) * 100}%`, backgroundColor: c.primary },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.recMark,
            { left: `${frac(recommended) * 100}%`, backgroundColor: c.muted },
          ]}
        />
        <View
          pointerEvents="none"
          style={[styles.thumb, { left: `${frac(shown) * 100}%`, backgroundColor: c.primary }]}
        />
      </View>
      <View style={styles.foot}>
        <AppText variant="caption" tone="muted">
          {props.format(min)}
        </AppText>
        <AppText variant="caption" tone="muted">
          {props.format(max)}
        </AppText>
      </View>
      {props.hint ? (
        <AppText variant="bodySmall" tone="muted">
          {props.hint}
        </AppText>
      ) : null}
      {!atRec ? (
        <Button
          variant="text"
          title="Reset to Recommended"
          onPress={() => props.onChange(null)}
          style={styles.reset}
        />
      ) : null}
    </View>
  );
}

const THUMB = 20;
const styles = StyleSheet.create({
  wrap: { gap: space.xs, paddingVertical: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  track: { height: TOUCH, justifyContent: 'center', marginHorizontal: THUMB / 2 },
  rail: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  fill: { right: undefined },
  recMark: { position: 'absolute', width: 2, height: 12, marginLeft: -1, borderRadius: 1 },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    marginLeft: -THUMB / 2,
  },
  foot: { flexDirection: 'row', justifyContent: 'space-between' },
  reset: { alignSelf: 'flex-start' },
});

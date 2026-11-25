import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';

import { useColors } from './theme';

const W = 52;
const H = 32;
const THUMB = 24;
const PAD = (H - THUMB) / 2;

/**
 * On/off switch drawn the same on Android and iOS (the native Switch looks different on
 * each). Use SwitchRow for settings; this alone only inside custom rows.
 */
export function Toggle(props: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  const [x] = useState(() => new Animated.Value(props.value ? 1 : 0));
  useEffect(() => {
    Animated.timing(x, {
      toValue: props.value ? 1 : 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [props.value, x]);
  return (
    <Pressable
      onPress={() => props.onChange(!props.value)}
      disabled={props.disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ checked: props.value, disabled: props.disabled }}
      style={[
        styles.track,
        { backgroundColor: props.value ? c.primary : c.surfaceHigh, borderColor: c.border },
        props.disabled && styles.disabled,
      ]}
    >
      <Animated.View
        style={[
          styles.thumb,
          {
            backgroundColor: props.value ? c.onPrimary : c.muted,
            transform: [
              {
                translateX: x.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, W - THUMB - 2 * PAD - 2],
                }),
              },
            ],
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, padding: PAD - 1, borderWidth: 1 },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2 },
  disabled: { opacity: 0.38 },
});

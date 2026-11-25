import { ActivityIndicator, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { Tappable } from './Tappable';
import { AppText } from './Text';
import { useColors } from './theme';
import { radius, space, TOUCH } from './tokens';

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text';

/**
 * Buttons (one look on Android and iOS: rounded rectangles, not pills). filled = the main action on a screen; tonal = secondary; outlined = a
 * neutral alternative; text = low-emphasis inline actions (Edit, Dismiss).
 */
export function Button(props: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const v = props.variant ?? 'tonal';
  const fg = props.danger
    ? v === 'filled'
      ? c.onDanger
      : c.danger
    : v === 'filled'
      ? c.onPrimary
      : v === 'tonal'
        ? c.onPrimaryContainer
        : c.primary;
  const bg =
    v === 'filled'
      ? props.danger
        ? c.danger
        : c.primary
      : v === 'tonal'
        ? c.primaryContainer
        : 'transparent';
  return (
    <Tappable
      onPress={props.onPress}
      feedback="dim"
      disabled={props.disabled || props.busy}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      accessibilityState={{ disabled: !!(props.disabled || props.busy), busy: !!props.busy }}
      style={[
        styles.base,
        v === 'text' ? styles.text : styles.box,
        { backgroundColor: bg },
        v === 'outlined' && { borderWidth: 1, borderColor: c.border },
        props.block && styles.block,
        props.disabled && styles.disabled,
        props.style,
      ]}
    >
      <View style={styles.inner}>
        {props.busy ? <ActivityIndicator size="small" color={fg} /> : null}
        <AppText variant="label" style={{ color: fg }}>
          {props.title}
        </AppText>
      </View>
    </Tappable>
  );
}

/** A row of buttons (dialog actions, card actions), right-aligned by default. */
export function ButtonRow({ children, start }: { children: React.ReactNode; start?: boolean }) {
  return <View style={[styles.row, start ? styles.rowStart : styles.rowEnd]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { minHeight: 40, borderRadius: radius.md, justifyContent: 'center', overflow: 'hidden' },
  box: { paddingHorizontal: space.xl, minHeight: TOUCH - space.sm },
  text: { paddingHorizontal: space.md },
  block: { alignSelf: 'stretch' },
  disabled: { opacity: 0.38 },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
});

/** A low-emphasis inline action (Edit, Dismiss, Allow…): a Material text button. */
export function TextButton(props: {
  title: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return <Button {...props} variant="text" />;
}

import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Tappable } from './Tappable';
import { useColors } from './theme';
import { TOUCH } from './tokens';

/**
 * An icon-only button with a 48 pt target. A label is required (it is what screen readers say).
 * selected = a toggled-on state (filled circle behind the icon).
 */
export function IconButton(props: {
  name: IconName;
  accessibilityLabel: string;
  onPress?: () => void;
  onLongPress?: () => void;
  size?: number;
  color?: string;
  selected?: boolean;
  /** 'switch' when it toggles something on and off. */
  role?: 'button' | 'switch';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const size = props.size ?? 24;
  const fg = props.selected ? c.onPrimary : (props.color ?? c.icon);
  return (
    <Tappable
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      disabled={props.disabled}
      hitSlop={0}
      feedback="dim"
      accessibilityRole={props.role ?? 'button'}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={
        props.role === 'switch'
          ? { checked: !!props.selected, disabled: props.disabled }
          : { disabled: props.disabled }
      }
      style={[styles.box, props.disabled && styles.disabled, props.style]}
    >
      <View
        style={[
          styles.inner,
          { width: size + 12, height: size + 12, borderRadius: (size + 12) / 2 },
          props.selected && { backgroundColor: c.primary },
        ]}
      >
        <Icon name={props.name} size={size} color={fg} />
      </View>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  box: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  inner: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.38 },
});

import { StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { Tappable } from './Tappable';
import { AppText } from './Text';
import { useColors } from './theme';
import { space, TOUCH } from './tokens';

/** One single-choice option: label, optional supporting text, a tick when selected. */
export function OptionItem(props: {
  label: string;
  supporting?: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Tappable
      onPress={props.onPress}
      hitSlop={0}
      style={styles.row}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      accessibilityLabel={props.supporting ? `${props.label}, ${props.supporting}` : props.label}
    >
      <View style={styles.text}>
        <AppText variant={props.selected ? 'bodyStrong' : 'body'}>{props.label}</AppText>
        {props.supporting ? (
          <AppText variant="bodySmall" tone="muted">
            {props.supporting}
          </AppText>
        ) : null}
      </View>
      <View style={styles.tick}>
        {props.selected ? <Icon name="check" size={22} color={c.primary} /> : null}
      </View>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.sm,
  },
  text: { flex: 1, gap: space.xxs },
  tick: { width: 24, alignItems: 'center' },
});

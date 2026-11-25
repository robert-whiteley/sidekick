import { StyleSheet, View } from 'react-native';

import { Tappable } from './Tappable';
import { AppText } from './Text';
import { useColors } from './theme';
import { radius, space, TOUCH } from './tokens';

/**
 * Segmented control (one look on Android and iOS): only for 2–3 short, mutually exclusive options shown together
 * (sort order, a view filter). Settings with more options use ChoiceRow (a bottom sheet).
 */
export function Segmented<T extends string | number>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  return (
    <View
      style={[styles.group, { borderColor: c.border }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={props.accessibilityLabel}
    >
      {props.options.map((o, i) => {
        const on = o.value === props.value;
        return (
          <Tappable
            key={String(o.value)}
            onPress={() => props.onChange(o.value)}
            hitSlop={0}
            feedback="dim"
            style={[
              styles.seg,
              i > 0 && { borderLeftWidth: 1, borderColor: c.border },
              on && { backgroundColor: c.primaryContainer },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
          >
            <AppText
              variant="label"
              numberOfLines={1}
              style={{ color: on ? c.onPrimaryContainer : c.text }}
            >
              {o.label}
            </AppText>
          </Tappable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  seg: {
    minHeight: TOUCH - space.sm,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
});

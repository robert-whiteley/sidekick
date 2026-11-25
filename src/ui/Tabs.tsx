import { ScrollView, StyleSheet, View } from 'react-native';

import { Tappable } from './Tappable';
import { AppText } from './Text';
import { useColors } from './theme';
import { space, TOUCH } from './tokens';

/**
 * Material scrollable tabs: switch between views of one screen (Memory: You, People, …).
 * The selected tab has a primary underline; the bar scrolls sideways when tabs don't fit.
 */
export function Tabs<T extends string>(props: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.bar, { borderColor: c.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist">
        {props.tabs.map((t) => {
          const on = t.id === props.value;
          return (
            <Tappable
              key={t.id}
              onPress={() => props.onChange(t.id)}
              hitSlop={0}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <AppText variant="label" tone={on ? 'primary' : 'muted'}>
                {t.label}
              </AppText>
              <View
                style={[styles.indicator, { backgroundColor: on ? c.primary : 'transparent' }]}
              />
            </Tappable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: -space.lg },
  tab: {
    minHeight: TOUCH,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indicator: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    bottom: 0,
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
});

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import { Tappable } from './Tappable';
import { AppText } from './Text';
import { useColors } from './theme';
import { space, TOUCH } from './tokens';

/**
 * A Material list item: title, optional supporting text, optional trailing control. Tappable when
 * onPress is given (with a chevron when it opens another page).
 */
export function ListRow(props: {
  title: string;
  supporting?: string | null;
  onPress?: () => void;
  /** Opens another page: shows a chevron and announces as a link. */
  navigates?: boolean;
  trailing?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  accessibilityRole?: 'button' | 'link' | 'switch' | 'radio';
  accessibilityState?: { checked?: boolean; disabled?: boolean; selected?: boolean };
  accessibilityHint?: string;
}) {
  const c = useColors();
  const body = (
    <>
      <View style={styles.text}>
        <AppText variant="body" tone={props.danger ? 'danger' : 'default'}>
          {props.title}
        </AppText>
        {props.supporting ? (
          <AppText variant="bodySmall" tone="muted">
            {props.supporting}
          </AppText>
        ) : null}
      </View>
      {props.trailing}
      {props.navigates ? <Icon name="chevron" size={20} color={c.muted} /> : null}
    </>
  );
  if (!props.onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Tappable
      onPress={props.onPress}
      disabled={props.disabled}
      hitSlop={0}
      style={[styles.row, props.disabled && styles.disabled]}
      accessibilityRole={props.accessibilityRole ?? (props.navigates ? 'link' : 'button')}
      accessibilityState={props.accessibilityState}
      accessibilityHint={props.accessibilityHint}
    >
      {body}
    </Tappable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: TOUCH + space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.sm,
  },
  text: { flex: 1, gap: space.xxs },
  disabled: { opacity: 0.38 },
});

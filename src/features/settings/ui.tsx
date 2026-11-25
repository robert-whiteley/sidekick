import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Button as UiButton, ListRow, showDialog, space, SwitchRow, TOUCH } from '@/ui';

export { ChoiceRow, Section } from '@/ui';

/** On/off setting (kept name: Row). */
export function Row(props: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SwitchRow
      title={props.label}
      supporting={props.hint}
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled}
    />
  );
}

/** A page-level action (tonal button, left-aligned). */
export function Button(props: {
  title: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <UiButton
      title={props.title}
      onPress={props.onPress}
      danger={props.danger}
      disabled={props.disabled}
      variant={props.danger ? 'outlined' : 'tonal'}
      style={styles.pageButton}
    />
  );
}

/** A row that opens another page (settings section, integration, Memory…). */
export function NavRow(props: { label: string; hint?: string; href: Href }) {
  return (
    <ListRow
      title={props.label}
      supporting={props.hint}
      navigates
      onPress={() => router.push(props.href)}
    />
  );
}

/** Asks before doing something that can't be undone. */
export function confirm(title: string, message: string, action: () => void | Promise<void>) {
  showDialog(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => void action() },
  ]);
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Colour-free layout helpers shared by the settings and memory pages. */
export const styles = StyleSheet.create({
  pageButton: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
  tapRow: { minHeight: TOUCH, justifyContent: 'center' },
  item: { paddingVertical: space.sm, gap: space.xs },
  group: { gap: space.xs, marginTop: space.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
});

import type { ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

export const ACCENT = '#2f6fed';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h}>{title}</Text>
      {children}
    </View>
  );
}

export function Row(props: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text style={styles.body}>{props.label}</Text>
        {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
      </View>
      <Switch value={props.value} onValueChange={props.onChange} />
    </View>
  );
}

export function Button(props: { title: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={styles.button} onPress={props.onPress} accessibilityRole="button">
      <Text style={[styles.buttonText, props.danger && styles.danger]}>{props.title}</Text>
    </Pressable>
  );
}

/** Asks before doing something that can't be undone. */
export function confirm(title: string, message: string, action: () => void | Promise<void>) {
  Alert.alert(title, message, [
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

export const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 8 },
  h: { fontSize: 18, fontWeight: '600', marginTop: 12 },
  body: { fontSize: 16, lineHeight: 22 },
  hint: { fontSize: 13, color: '#666', lineHeight: 18 },
  label: { fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  button: { backgroundColor: '#f2f2f5', padding: 12, borderRadius: 12 },
  buttonText: { fontSize: 16, color: ACCENT },
  danger: { color: '#b00020' },
  input: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f2f2f5',
  },
  item: { paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee', gap: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  small: { fontSize: 13, color: '#666' },
  link: { fontSize: 14, color: ACCENT },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#eee' },
  chipOn: { backgroundColor: ACCENT },
  chipText: { fontSize: 14, color: '#333' },
  chipTextOn: { color: 'white' },
});

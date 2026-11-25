import type { Href } from 'expo-router';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { choiceChips, type Option } from './choice-logic';

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

/** A row that opens another page (settings section, integration, Memory…). */
export function NavRow(props: { label: string; hint?: string; href: Href }) {
  return (
    <Pressable
      style={[styles.item, styles.itemRow]}
      onPress={() => router.push(props.href)}
      accessibilityRole="link"
    >
      <View style={styles.flex}>
        <Text style={styles.body}>{props.label}</Text>
        {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/**
 * A choice with this phone's Recommended value marked. value null = following Recommended;
 * onChange(null) = back to Recommended.
 */
export function ChoiceRow<T extends string | number>(props: {
  label: string;
  hint?: string;
  options: Option<T>[];
  value: T | null;
  recommended: T;
  onChange: (v: T | null) => void;
}) {
  const chips = choiceChips(props.options, props.value, props.recommended);
  return (
    <View style={styles.choice}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.chips}>
        {chips.map((c) => (
          <Pressable
            key={String(c.value)}
            onPress={() => props.onChange(c.store)}
            style={[styles.chip, c.selected && styles.chipOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: c.selected }}
          >
            <Text style={[styles.chipText, c.selected && styles.chipTextOn]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      {props.hint ? <Text style={styles.hint}>{props.hint}</Text> : null}
    </View>
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
  chevron: { fontSize: 22, color: '#999' },
  choice: { gap: 6 },
});

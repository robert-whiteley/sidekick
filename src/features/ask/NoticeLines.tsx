import { type Href, router } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Notice, notices } from '@/engine/notices';
import type { ChatTheme } from './theme';

/** Keeps the shared notice list (src/engine/notices.ts) in React state. */
export function useNotices(): Notice[] {
  return useSyncExternalStore(
    (onChange) => notices.subscribe(onChange),
    () => notices.all,
  );
}

/**
 * One notice in the chat. 'info': a faint small line; tap opens the setting it is about.
 * 'decision': a card with its buttons.
 */
export function NoticeItem({ n, theme }: { n: Notice; theme: ChatTheme }) {
  if (n.kind === 'info') {
    return (
      <Pressable
        onPress={() => n.href && router.push(n.href as Href)}
        disabled={!n.href}
        accessibilityRole={n.href ? 'link' : 'text'}
        style={styles.info}
      >
        <Text style={[styles.infoText, { color: theme.faint }]}>{n.text}</Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.cardText, { color: theme.text }]}>{n.text}</Text>
      <View style={styles.actions}>
        {(n.actions ?? []).map((a) => (
          <Pressable
            key={a.id}
            onPress={() => notices.act(n.key, a.id)}
            style={[styles.action, { borderColor: theme.border }]}
            accessibilityRole="button"
          >
            <Text style={[styles.actionText, { color: theme.text }]}>{a.label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => notices.dismiss(n.key)}
          style={styles.action}
          accessibilityRole="button"
        >
          <Text style={[styles.actionText, { color: theme.faint }]}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  info: { alignSelf: 'center', paddingVertical: 2 },
  infoText: { fontSize: 12, textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  cardText: { fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionText: { fontSize: 14, fontWeight: '600' },
});

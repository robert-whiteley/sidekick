import { type Href, router } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { type Notice, notices } from '@/engine/notices';
import type { ChatTheme } from './theme';
import { AppText, Button, radius, space, Tappable } from '@/ui';

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
      <Tappable
        feedback="dim"
        onPress={() => n.href && router.push(n.href as Href)}
        disabled={!n.href}
        accessibilityRole={n.href ? 'link' : 'text'}
        style={styles.info}
      >
        <AppText variant="caption" style={[styles.infoText, { color: theme.faint }]}>
          {n.text}
        </AppText>
      </Tappable>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <AppText variant="bodySmall" style={{ color: theme.text }}>
        {n.text}
      </AppText>
      <View style={styles.actions}>
        {(n.actions ?? []).map((a) => (
          <Button
            key={a.id}
            variant="outlined"
            title={a.label}
            onPress={() => notices.act(n.key, a.id)}
          />
        ))}
        <Button variant="text" title="Not now" onPress={() => notices.dismiss(n.key)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  info: { alignSelf: 'center', paddingVertical: space.xxs },
  infoText: { textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

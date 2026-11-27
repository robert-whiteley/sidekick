import { type Href, router } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { actionable, type Notice, notices } from '@/engine/notices';
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
  if (n.armAt !== undefined || n.expiresAt !== undefined)
    return <ApprovalCard n={n} theme={theme} />;
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

/**
 * A critical settings change waiting for a tap (settings-registry.ts). The Approve button sits at
 * the card's top right, away from the send button and the reply's own buttons below it, works
 * only after a short delay, and the card goes away by itself when not used.
 */
function ApprovalCard({ n, theme }: { n: Notice; theme: ChatTheme }) {
  const [ready, setReady] = useState(() => actionable(n, Date.now()));
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (n.armAt ?? 0) - Date.now();
    if (wait > 0) timers.push(setTimeout(() => setReady(actionable(n, Date.now())), wait + 20));
    if (n.expiresAt !== undefined)
      timers.push(setTimeout(() => notices.expire(), Math.max(0, n.expiresAt - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [n]);
  const approve = n.actions?.[0];
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.top}>
        <AppText variant="bodySmall" style={[styles.flex, { color: theme.text }]}>
          {n.text}
        </AppText>
        {approve ? (
          <Button
            variant="filled"
            title={approve.label}
            disabled={!ready}
            accessibilityLabel={ready ? approve.label : `${approve.label}, available in a moment`}
            onPress={() => notices.act(n.key, approve.id)}
          />
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button variant="text" title="Cancel" onPress={() => notices.dismiss(n.key)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
  info: { alignSelf: 'center', paddingVertical: space.xxs },
  infoText: { textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});

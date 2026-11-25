import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon';
import type { ChatTheme } from './theme';
import { OnlineBadge } from './WebLookupUi';

/** Top bar: menu (Memory, Off the record), online state, background listening, Settings. */
export function ChatHeader({
  theme,
  offRecord,
  onOffRecord,
  listening,
  onListen,
  webUsed,
  live = false,
  onStopLive,
}: {
  theme: ChatTheme;
  offRecord: boolean;
  onOffRecord: (on: boolean) => void;
  listening: boolean;
  onListen: () => void;
  webUsed: boolean;
  /** Live camera memory is running (also with the camera view closed): tap to stop. */
  live?: boolean;
  onStopLive?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const item = (label: string, run: () => void) => (
    <Pressable
      key={label}
      style={styles.item}
      accessibilityRole="menuitem"
      onPress={() => {
        setMenu(false);
        run();
      }}
    >
      <Text style={[styles.itemText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Pressable
          onPress={() => setMenu((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Menu"
        >
          <Icon name="menu" color={theme.icon} />
        </Pressable>
        <OnlineBadge used={webUsed} />
        {live ? (
          <Pressable
            onPress={onStopLive}
            hitSlop={8}
            style={[styles.live, { backgroundColor: theme.danger }]}
            accessibilityRole="button"
            accessibilityLabel="Live camera on. Tap to stop."
          >
            <Text style={styles.liveText}>● Live</Text>
          </Pressable>
        ) : null}
        <View style={styles.right}>
          <Pressable
            onPress={onListen}
            hitSlop={10}
            style={[styles.listen, listening && { backgroundColor: theme.accent }]}
            accessibilityRole="switch"
            accessibilityState={{ checked: listening }}
            accessibilityLabel="Listen in the background"
          >
            <Icon name="listen" size={20} color={listening ? theme.bg : theme.icon} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Icon name="settings" color={theme.icon} />
          </Pressable>
        </View>
      </View>
      {menu ? (
        <View style={[styles.menu, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {item('Memory', () => router.push('/memory'))}
          {item(offRecord ? 'Leave Off the record' : 'Off the record', () =>
            onOffRecord(!offRecord),
          )}
        </View>
      ) : null}
      {offRecord ? (
        <Pressable
          onPress={() => onOffRecord(false)}
          style={[styles.banner, { borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Off the record. Tap to leave."
        >
          <Icon name="offRecord" size={16} color={theme.faint} />
          <Text style={[styles.bannerText, { color: theme.faint }]}>
            Off the record: this chat won&apos;t be saved · Leave
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 2 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  right: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 16 },
  listen: { borderRadius: 16, padding: 4 },
  live: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  liveText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  menu: {
    position: 'absolute',
    top: 48,
    left: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 200,
    elevation: 4,
  },
  item: { paddingHorizontal: 16, paddingVertical: 12 },
  itemText: { fontSize: 16 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  bannerText: { fontSize: 13 },
});

import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Icon } from './Icon';
import type { ChatTheme } from './theme';
import { OnlineBadge } from './WebLookupUi';
import { AppText, IconButton, radius, space, Tappable } from '@/ui';

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
    <Tappable
      key={label}
      hitSlop={0}
      style={styles.item}
      accessibilityRole="menuitem"
      onPress={() => {
        setMenu(false);
        run();
      }}
    >
      <AppText style={{ color: theme.text }}>{label}</AppText>
    </Tappable>
  );
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <IconButton
          name="menu"
          color={theme.icon}
          onPress={() => setMenu((v) => !v)}
          accessibilityLabel="Menu"
        />
        <OnlineBadge used={webUsed} />
        {live ? (
          <Tappable
            onPress={onStopLive}
            feedback="dim"
            style={[styles.live, { backgroundColor: theme.danger }]}
            accessibilityRole="button"
            accessibilityLabel="Live camera on. Tap to stop."
          >
            <View style={[styles.dot, { backgroundColor: theme.bg }]} />
            <AppText variant="badge" style={{ color: theme.bg }}>
              Live
            </AppText>
          </Tappable>
        ) : null}
        <View style={styles.right}>
          {/* iPhone apps can't listen in the background (ADR 0006): hold the mic instead. */}
          {Platform.OS !== 'ios' && (
            <IconButton
              name="listen"
              size={20}
              color={theme.icon}
              selected={listening}
              role="switch"
              onPress={onListen}
              accessibilityLabel="Listen in the background"
            />
          )}
          <IconButton
            name="settings"
            color={theme.icon}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Settings"
          />
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
        <Tappable
          hitSlop={0}
          onPress={() => onOffRecord(false)}
          style={[styles.banner, { borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Off the record. Tap to leave."
        >
          <Icon name="offRecord" size={16} color={theme.faint} />
          <AppText variant="bodySmall" style={{ color: theme.faint }}>
            Off the record: this chat won&apos;t be saved · Leave
          </AppText>
        </Tappable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 2 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
  },
  right: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  menu: {
    position: 'absolute',
    top: 48,
    left: 12,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.xs,
    minWidth: 200,
    elevation: 4,
  },
  item: { paddingHorizontal: space.lg, paddingVertical: space.md },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 40,
    borderBottomWidth: 1,
  },
});

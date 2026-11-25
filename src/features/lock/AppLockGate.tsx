import * as LocalAuthentication from 'expo-local-authentication';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { needsUnlock } from '@/engine/app-lock-logic';
import { getSettings, onSettingsChange } from '@/engine/settings';
import { AppText, Button, space, useColors } from '@/ui';

/**
 * Covers the app until the owner unlocks it (Settings → Privacy → App lock). The cover is drawn
 * over everything, so the chat isn't visible in the app switcher or before unlocking either.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() =>
    needsUnlock({ enabled: getSettings().appLock, leftAt: null, now: Date.now(), afterMin: null }),
  );
  const leftAt = useRef<number | null>(null);
  const lockedRef = useRef(locked);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  const asking = useRef(false);
  const c = useColors();

  const unlock = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Sidekick' });
      if (r.success) setLocked(false);
    } catch {
      // Stays locked; the button tries again.
    } finally {
      asking.current = false;
    }
  }, []);

  // Ask once on open; later locks ask from the AppState handler below.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the prompt is an external system; state changes after it answers
    if (getSettings().appLock) void unlock();
  }, [unlock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const s = getSettings();
      // The fingerprint prompt itself sends the app to 'inactive'/'background' briefly: ignore
      // changes while it is up.
      if (asking.current) return;
      if (state === 'background') {
        leftAt.current = Date.now();
        // Cover at once when it asks every time, so the app switcher shows nothing.
        if (s.appLock && (s.appLockAfterMin ?? 1) === 0) setLocked(true);
      } else if (state === 'active' && leftAt.current !== null) {
        const due = needsUnlock({
          enabled: s.appLock,
          leftAt: leftAt.current,
          now: Date.now(),
          afterMin: s.appLockAfterMin,
        });
        leftAt.current = null;
        if (due) {
          setLocked(true);
          void unlock();
        } else if (lockedRef.current) void unlock();
      }
    });
    const off = onSettingsChange((s) => {
      if (!s.appLock) setLocked(false);
    });
    return () => {
      sub.remove();
      off();
    };
  }, [unlock]);

  return (
    <View style={styles.fill}>
      {children}
      {locked ? (
        <View style={[StyleSheet.absoluteFill, styles.cover, { backgroundColor: c.bg }]}>
          <AppText variant="title">Sidekick is locked</AppText>
          <Button title="Unlock" variant="filled" onPress={() => void unlock()} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
    zIndex: 1000,
    elevation: 1000,
  },
});

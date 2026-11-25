import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useState } from 'react';

import {
  APP_LOCK_AFTER_MIN,
  APP_LOCK_CHOICES,
  lockAfterLabel,
  lockAvailable,
} from '@/engine/app-lock-logic';
import { ChoiceRow, Row, Section } from './ui';
import { useSettings } from './useSettings';
import { AppText } from '@/ui';

/** Settings → Privacy → App lock: fingerprint, face or the phone's PIN to open Sidekick. */
export function AppLockSection() {
  const { s, set } = useSettings();
  const [level, setLevel] = useState<number | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    LocalAuthentication.getEnrolledLevelAsync()
      .then(setLevel)
      .catch(() => setLevel(0));
  }, []);
  const can = level === null || lockAvailable(level);

  const toggle = async (on: boolean) => {
    setNote('');
    if (!on) {
      // Turning it off also needs the owner: otherwise anyone holding the phone could.
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Turn off app lock' });
      if (r.success) set({ appLock: false });
      return;
    }
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Turn on app lock' });
    if (r.success) set({ appLock: true });
    else if (r.error === 'not_enrolled' || r.error === 'passcode_not_set')
      setNote('Set a screen lock on the phone first (Settings → Security).');
  };

  return (
    <Section title="App lock">
      <Row
        label="Lock Sidekick"
        hint={
          can
            ? 'Asks for your fingerprint, face or phone PIN to open Sidekick. Spoken answers while the screen is off still need the phone unlocked for anything personal.'
            : 'Not possible on this phone: it has no screen lock. Set one in the phone’s Settings → Security first.'
        }
        value={s.appLock}
        onChange={(v) => void toggle(v)}
      />
      {note ? (
        <AppText variant="bodySmall" tone="muted">
          {note}
        </AppText>
      ) : null}
      {s.appLock ? (
        <ChoiceRow
          label="Ask again"
          options={APP_LOCK_CHOICES.map((m) => ({ value: m, label: lockAfterLabel(m) }))}
          value={s.appLockAfterMin}
          recommended={APP_LOCK_AFTER_MIN}
          onChange={(v) => set({ appLockAfterMin: v })}
        />
      ) : null}
    </Section>
  );
}

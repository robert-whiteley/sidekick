import { useEffect, useState } from 'react';

import { backupNow, driveBackupOn } from '@/engine/drive-backup-schedule';
import { googleConfigured } from '@/integrations/google';
import { onPrefsChange } from '@/integrations/prefs';
import { Button, formatTime, NavRow, Section } from './ui';
import { useSettings } from './useSettings';
import { AppText } from '@/ui';

/** Settings → Privacy: the Google Drive backup (weekly on Wi-Fi + charging) and "Back up now". */
export function DriveBackupSection() {
  const { s } = useSettings();
  const [on, setOn] = useState(driveBackupOn);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => onPrefsChange(() => setOn(driveBackupOn())), []);
  if (!googleConfigured()) return null;
  return (
    <Section title="Google Drive backup">
      <AppText variant="bodySmall" tone="muted">
        {on
          ? `Backs up weekly on Wi-Fi while charging, keeping the last two backups. ${
              s.lastDriveBackupAt
                ? `Last: ${formatTime(s.lastDriveBackupAt)}.`
                : 'Not backed up yet.'
            } To restore, download a backup from Drive and open it on your computer; it is the same zip as Export everything.`
          : 'Off. Turn on "Back up to Google Drive" in Connections.'}
      </AppText>
      {on ? (
        <Button
          title={busy ? 'Backing up…' : 'Back up now'}
          onPress={() => {
            if (busy) return;
            setBusy(true);
            setMsg('');
            void backupNow()
              .then((ok) =>
                setMsg(ok ? 'Backed up to Google Drive.' : 'Backup failed; see the chat.'),
              )
              .finally(() => setBusy(false));
          }}
        />
      ) : (
        <NavRow label="Connections" href="/settings/connections" />
      )}
      {msg ? (
        <AppText variant="bodySmall" tone="muted">
          {msg}
        </AppText>
      ) : null}
    </Section>
  );
}

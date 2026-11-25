import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { backupNow, driveBackupOn } from '@/engine/drive-backup-schedule';
import { googleConfigured } from '@/integrations/google';
import { onPrefsChange } from '@/integrations/prefs';
import { Button, formatTime, NavRow, Section, styles } from './ui';
import { useSettings } from './useSettings';

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
      <Text style={styles.hint}>
        {on
          ? `Backs up weekly on Wi-Fi while charging, keeping the last two backups. ${
              s.lastDriveBackupAt
                ? `Last: ${formatTime(s.lastDriveBackupAt)}.`
                : 'Not backed up yet.'
            } To restore, download a backup from Drive and open it on your computer; it is the same zip as Export everything.`
          : 'Off. Turn on "Back up to Google Drive" in Connections.'}
      </Text>
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
      {msg ? <Text style={styles.small}>{msg}</Text> : null}
    </Section>
  );
}

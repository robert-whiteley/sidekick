import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Text } from 'react-native';

import { syncFollowupNotifications } from '@/engine/followup-notify';
import { deleteEverything, deleteRange, exportEverything } from '@/memory/store';
import { DeleteBySource } from './SourcesSection';
import { Button, confirm, Section, styles } from './ui';

export function DataSection({ onChanged }: { onChanged: () => void }) {
  const [msg, setMsg] = useState('');

  const exportAll = async () => {
    setMsg('Preparing export…');
    try {
      const path = await exportEverything();
      setMsg('');
      await Sharing.shareAsync(`file://${path}`, { mimeType: 'application/zip' });
    } catch (e) {
      setMsg(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  return (
    <Section title="Your data">
      <Text style={styles.hint}>
        Everything is stored encrypted on this phone only. Export gives you all of it (text and
        photos) as a zip.
      </Text>
      <Button title="Export everything" onPress={() => void exportAll()} />
      <Button
        danger
        title="Delete the last hour"
        onPress={() =>
          confirm(
            'Delete the last hour?',
            'Everything from the last hour is deleted.',
            async () => {
              await deleteRange(Date.now() - 3600_000, Date.now() + 60_000);
              onChanged();
            },
          )
        }
      />
      <Button
        danger
        title="Delete today"
        onPress={() =>
          confirm('Delete today?', 'Everything from today is deleted.', async () => {
            await deleteRange(startOfToday(), Date.now() + 60_000);
            onChanged();
          })
        }
      />
      <DeleteBySource onChanged={onChanged} />
      <Button
        danger
        title="Delete everything"
        onPress={() =>
          confirm(
            'Delete everything?',
            'All memories, people, facts and photos are permanently deleted.',
            async () => {
              await deleteEverything();
              await syncFollowupNotifications(); // drop reminders for deleted follow-ups
              onChanged();
            },
          )
        }
      />
      {msg ? <Text style={styles.hint}>{msg}</Text> : null}
    </Section>
  );
}

import { useState } from 'react';

import { deleteAllData, exportAllData } from '@/engine/data-export';
import { platformText } from '@/engine/platform-text';
import { deleteRange } from '@/memory/store';
import { DeleteBySource } from './SourcesSection';
import { Button, confirm, Section } from './ui';
import { AppText } from '@/ui';

export function DataSection({ onChanged }: { onChanged: () => void }) {
  const [msg, setMsg] = useState('');

  const exportAll = async () => {
    setMsg('Choose a folder for the export…');
    try {
      const r = await exportAllData();
      setMsg(r ? `Exported ${r.files} files to "${r.folder}".` : '');
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
      <AppText variant="bodySmall" tone="muted">
        {platformText('exportHint')}
      </AppText>
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
          confirm('Delete everything?', platformText('deleteAllBody'), async () => {
            await deleteAllData();
          })
        }
      />
      {msg ? (
        <AppText variant="bodySmall" tone="muted">
          {msg}
        </AppText>
      ) : null}
    </Section>
  );
}

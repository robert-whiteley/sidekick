import { useState } from 'react';

import { deleteAllData, exportAllData } from '@/engine/data-export';
import { askToDelete } from '@/engine/delete-plans';
import { platformText } from '@/engine/platform-text';
import { deleteRange } from '@/memory/store';
import { DeleteBySource } from './SourcesSection';
import { Button, Section } from './ui';
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
        onPress={() => {
          const from = Date.now() - 3600_000;
          const to = Date.now() + 60_000;
          void askToDelete({ kind: 'range', from, to, label: 'the last hour' }, async () => {
            await deleteRange(from, to);
            onChanged();
          });
        }}
      />
      <Button
        danger
        title="Delete today"
        onPress={() => {
          const from = startOfToday();
          const to = Date.now() + 60_000;
          void askToDelete({ kind: 'range', from, to, label: 'today' }, async () => {
            await deleteRange(from, to);
            onChanged();
          });
        }}
      />
      <DeleteBySource onChanged={onChanged} />
      <Button
        danger
        title="Delete everything"
        onPress={() => void askToDelete({ kind: 'everything' }, deleteAllData)}
      />
      {msg ? (
        <AppText variant="bodySmall" tone="muted">
          {msg}
        </AppText>
      ) : null}
    </Section>
  );
}

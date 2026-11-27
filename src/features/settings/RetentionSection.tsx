import { useState } from 'react';

import { getSettings, updateSettings } from '@/engine/settings';
import { applyRetention } from '@/memory/store';
import { PickerRow } from '@/ui';
import { Row, Section } from './ui';

const OPTIONS = [
  { days: 0, label: 'Forever' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

export function RetentionSection({ onChanged }: { onChanged: () => void }) {
  const [days, setDays] = useState(getSettings().retentionDays);
  const [sensitive, setSensitive] = useState(getSettings().suggestSensitiveFacts);
  const pick = async (d: number) => {
    setDays(d);
    updateSettings({ retentionDays: d });
    await applyRetention();
    onChanged();
  };
  return (
    <Section title="Memory">
      <PickerRow
        label="Keep memories for"
        hint="Older memories are deleted automatically."
        options={OPTIONS.map((o) => ({ value: o.days, label: o.label }))}
        value={days}
        onChange={(d) => void pick(d)}
      />
      <Row
        label="Suggest private facts"
        hint={
          'Off: Sidekick never suggests saving facts about health, religion or beliefs, ' +
          "sexuality, politics or money, yours or other people's. What you ask it to remember " +
          'is always saved.'
        }
        value={sensitive}
        onChange={(v) => {
          setSensitive(v);
          updateSettings({ suggestSensitiveFacts: v });
        }}
      />
    </Section>
  );
}

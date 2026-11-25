import { useState } from 'react';

import { readDeviceProfile } from '@/engine/device-profile';
import { INTEGRATIONS } from '@/integrations/registry';
import { Page } from '@/features/settings/Page';
import { SourcesSection } from '@/features/settings/SourcesSection';
import { useSettings } from '@/features/settings/useSettings';
import { ChoiceRow, NavRow, Section } from '@/features/settings/ui';
import { integrationAvailability } from '@/features/settings/connections-logic';

export default function ConnectionsSettings() {
  const [profile] = useState(() => readDeviceProfile());
  const { s: settings, set } = useSettings();
  return (
    <Page title="Connections">
      <Section title="Sending">
        <ChoiceRow
          label="Messages, emails, events and calls"
          hint="A card shows what will be sent; Cancel or say stop during the countdown."
          options={[
            { value: 'countdown', label: 'After 5 s' },
            { value: 'instant', label: 'At once' },
            { value: 'ask', label: 'Ask me first' },
          ]}
          value={settings.actionSend === 'countdown' ? null : settings.actionSend}
          recommended="countdown"
          onChange={(v) => set({ actionSend: v ?? 'countdown' })}
        />
      </Section>
      <Section title="Apps Sidekick can use">
        {INTEGRATIONS.map((i) => {
          const a = integrationAvailability(i, profile);
          return (
            <NavRow
              key={i.id}
              label={i.name}
              hint={a.available ? i.description : a.why}
              href={{ pathname: '/settings/connections/[id]', params: { id: i.id } }}
            />
          );
        })}
      </Section>
      <SourcesSection onChanged={() => {}} />
    </Page>
  );
}

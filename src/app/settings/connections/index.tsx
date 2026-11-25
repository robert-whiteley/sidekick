import { useState } from 'react';

import { readDeviceProfile } from '@/engine/device-profile';
import { INTEGRATIONS } from '@/integrations/registry';
import { Page } from '@/features/settings/Page';
import { SourcesSection } from '@/features/settings/SourcesSection';
import { NavRow, Section } from '@/features/settings/ui';
import { integrationAvailability } from '@/features/settings/connections-logic';

export default function ConnectionsSettings() {
  const [profile] = useState(() => readDeviceProfile());
  return (
    <Page title="Connections">
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

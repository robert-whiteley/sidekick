import { useState } from 'react';

import { phoneFeatures, readDeviceProfile, speedTier } from '@/engine/device-profile';
import { Page } from '@/features/settings/Page';
import { Section } from '@/features/settings/ui';
import { AppText, Icon, ListRow, useColors } from '@/ui';

const TIER = { high: 'fast', mid: 'medium', low: 'slower' };

export default function PhoneFeatures() {
  const c = useColors();
  const [p] = useState(() => readDeviceProfile());
  const features = phoneFeatures(p);
  return (
    <Page title="Phone features">
      <AppText variant="bodySmall" tone="muted">
        {`${p.manufacturer} ${p.model}`.trim() || 'This phone'}
        {p.ramMb ? ` · ${Math.round(p.ramMb / 1024)} GB memory` : ''}
        {p.soc ? ` · ${p.soc}` : ''} · {TIER[speedTier(p)]} for AI
      </AppText>
      <Section title="On this phone">
        {features.map((f) => (
          <ListRow
            key={f.id}
            title={f.name}
            supporting={f.available ? 'Available' : (f.why ?? 'Not available on this phone')}
            trailing={
              <Icon
                name={f.available ? 'check' : 'close'}
                size={20}
                color={f.available ? c.success : c.muted}
              />
            }
          />
        ))}
      </Section>
    </Page>
  );
}

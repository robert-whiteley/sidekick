import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { readDeviceProfile } from '@/engine/device-profile';
import { connectGoogle } from '@/integrations/google';
import { isOn, onPrefsChange, setSwitch } from '@/integrations/prefs';
import { integration } from '@/integrations/registry';
import { integrationAvailability } from '@/features/settings/connections-logic';
import { Page } from '@/features/settings/Page';
import { Row, Section } from '@/features/settings/ui';
import { AppText } from '@/ui';

export default function ConnectionSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = integration(id);
  const [, bump] = useState(0);
  useEffect(() => onPrefsChange(() => bump((n) => n + 1)), []);
  if (!item) {
    return (
      <Page title="Connection">
        <AppText variant="bodySmall" tone="muted">
          Not found.
        </AppText>
      </Page>
    );
  }
  const profile = readDeviceProfile();
  const a = integrationAvailability(item, profile);
  const needs = profile.platform === 'ios' ? (item.needsIphone ?? item.needs) : item.needs;
  return (
    <Page title={item.name}>
      <Section title={item.name}>
        {/* Unavailable on iPhone: the Android description would only list what isn't there. */}
        {a.available || profile.platform !== 'ios' ? <AppText>{item.description}</AppText> : null}
        {!a.available && (
          <AppText variant="bodySmall" tone="muted">
            {a.why}
          </AppText>
        )}
        {a.available &&
          item.switches
            .filter((sw) => !a.only || a.only.includes(sw.id))
            .map((sw) => (
              <Row
                key={sw.id}
                label={sw.label}
                value={isOn(item.id, sw.id)}
                onChange={(v) => {
                  // Google features ask Google's own consent for just that access first.
                  if (v && item.google) void connectGoogle(item.google);
                  else setSwitch(item.id, sw.id, v);
                }}
              />
            ))}
        {a.available && needs ? (
          <AppText variant="bodySmall" tone="muted">
            Needs: {needs}
          </AppText>
        ) : null}
      </Section>
    </Page>
  );
}

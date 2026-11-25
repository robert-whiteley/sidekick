import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { readDeviceProfile } from '@/engine/device-profile';
import { isOn, onPrefsChange, setSwitch } from '@/integrations/prefs';
import { integration } from '@/integrations/registry';
import { integrationAvailability } from '@/features/settings/connections-logic';
import { Page } from '@/features/settings/Page';
import { Row, Section, styles } from '@/features/settings/ui';

export default function ConnectionSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = integration(id);
  const [, bump] = useState(0);
  useEffect(() => onPrefsChange(() => bump((n) => n + 1)), []);
  if (!item) {
    return (
      <Page title="Connection">
        <Text style={styles.hint}>Not found.</Text>
      </Page>
    );
  }
  const a = integrationAvailability(item, readDeviceProfile());
  return (
    <Page title={item.name}>
      <Section title={item.name}>
        <Text style={styles.body}>{item.description}</Text>
        {!a.available && <Text style={styles.hint}>{a.why}</Text>}
        {a.available &&
          item.switches.map((sw) => (
            <Row
              key={sw.id}
              label={sw.label}
              value={isOn(item.id, sw.id)}
              onChange={(v) => setSwitch(item.id, sw.id, v)}
            />
          ))}
        {a.available && item.needs ? <Text style={styles.hint}>Needs: {item.needs}</Text> : null}
      </Section>
    </Page>
  );
}

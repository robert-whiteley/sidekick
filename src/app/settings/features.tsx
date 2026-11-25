import { useState } from 'react';
import { Text, View } from 'react-native';

import { phoneFeatures, readDeviceProfile, speedTier } from '@/engine/device-profile';
import { Page } from '@/features/settings/Page';
import { Section, styles } from '@/features/settings/ui';

const TIER = { high: 'fast', mid: 'medium', low: 'slower' };

export default function PhoneFeatures() {
  const [p] = useState(() => readDeviceProfile());
  const features = phoneFeatures(p);
  return (
    <Page title="Phone features">
      <Text style={styles.hint}>
        {`${p.manufacturer} ${p.model}`.trim() || 'This phone'}
        {p.ramMb ? ` · ${Math.round(p.ramMb / 1024)} GB memory` : ''}
        {p.soc ? ` · ${p.soc}` : ''} · {TIER[speedTier(p)]} for AI
      </Text>
      <Section title="On this phone">
        {features.map((f) => (
          <View key={f.id} style={styles.item}>
            <Text style={styles.body}>
              {f.available ? '✓ ' : '✕ '}
              {f.name}
            </Text>
            {!f.available && f.why ? <Text style={styles.hint}>{f.why}</Text> : null}
          </View>
        ))}
      </Section>
    </Page>
  );
}

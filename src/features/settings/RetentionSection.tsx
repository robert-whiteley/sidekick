import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { getSettings, updateSettings } from '@/engine/settings';
import { applyRetention } from '@/memory/store';
import { Section, styles } from './ui';

const OPTIONS = [
  { days: 0, label: 'Forever' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

export function RetentionSection({ onChanged }: { onChanged: () => void }) {
  const [days, setDays] = useState(getSettings().retentionDays);
  const pick = async (d: number) => {
    setDays(d);
    updateSettings({ retentionDays: d });
    await applyRetention();
    onChanged();
  };
  return (
    <Section title="Keep memories for">
      <View style={styles.chips}>
        {OPTIONS.map((o) => (
          <Pressable
            key={o.days}
            onPress={() => void pick(o.days)}
            style={[styles.chip, days === o.days && styles.chipOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: days === o.days }}
          >
            <Text style={[styles.chipText, days === o.days && styles.chipTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>Older memories are deleted automatically.</Text>
    </Section>
  );
}

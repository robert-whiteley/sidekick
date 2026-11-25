import { View } from 'react-native';

import { deleteFact, saveFact, savedFacts } from '@/memory/store';
import { Section, styles } from './ui';
import { AppText, TextButton } from '@/ui';

export type Fact = Awaited<ReturnType<typeof savedFacts>>[number];

export function FactsSection({ facts, onChanged }: { facts: Fact[]; onChanged: () => void }) {
  const approve = async (f: Fact) => {
    await saveFact(f.text, 'saved');
    await deleteFact(f.id);
    onChanged();
  };
  const remove = async (f: Fact) => {
    await deleteFact(f.id);
    onChanged();
  };
  const suggested = facts.filter((f) => f.status === 'suggested');
  const saved = facts.filter((f) => f.status === 'saved');
  return (
    <Section title="About you">
      <AppText variant="bodySmall" tone="muted">
        {'Say "remember that…" to save a fact.'}
      </AppText>
      {suggested.length > 0 && (
        <AppText>Suggested from what you said (only used once you approve)</AppText>
      )}
      {suggested.map((f) => (
        <View key={f.id} style={[styles.item, styles.itemRow]}>
          <AppText style={styles.flex}>{f.text}</AppText>
          <TextButton title="Approve" onPress={() => void approve(f)} />
          <TextButton title="Reject" onPress={() => void remove(f)} danger />
        </View>
      ))}
      {saved.length === 0 && suggested.length === 0 && (
        <AppText variant="bodySmall" tone="muted">
          No facts saved yet.
        </AppText>
      )}
      {saved.map((f) => (
        <View key={f.id} style={[styles.item, styles.itemRow]}>
          <AppText style={styles.flex}>{f.text}</AppText>
          <TextButton title="Delete" onPress={() => void remove(f)} danger />
        </View>
      ))}
    </Section>
  );
}

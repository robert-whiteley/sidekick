import { Pressable, Text, View } from 'react-native';

import { deleteFact, saveFact, savedFacts } from '@/memory/store';
import { Section, styles } from './ui';

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
      <Text style={styles.hint}>{'Say "remember that…" to save a fact.'}</Text>
      {suggested.length > 0 && (
        <Text style={styles.body}>Suggested from what you said (only used once you approve)</Text>
      )}
      {suggested.map((f) => (
        <View key={f.id} style={[styles.item, styles.itemRow]}>
          <Text style={[styles.body, styles.flex]}>{f.text}</Text>
          <Pressable onPress={() => void approve(f)}>
            <Text style={styles.link}>Approve</Text>
          </Pressable>
          <Pressable onPress={() => void remove(f)}>
            <Text style={[styles.link, styles.danger]}>Reject</Text>
          </Pressable>
        </View>
      ))}
      {saved.length === 0 && suggested.length === 0 && (
        <Text style={styles.hint}>No facts saved yet.</Text>
      )}
      {saved.map((f) => (
        <View key={f.id} style={[styles.item, styles.itemRow]}>
          <Text style={[styles.body, styles.flex]}>{f.text}</Text>
          <Pressable onPress={() => void remove(f)}>
            <Text style={[styles.link, styles.danger]}>Delete</Text>
          </Pressable>
        </View>
      ))}
    </Section>
  );
}

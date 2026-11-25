import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { buildDayRecap } from '@/engine/day-recap';
import { Section, styles } from '@/features/settings/ui';
import { type DayRecap, isEmptyRecap } from '@/memory/day-recap-logic';

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Your day": the day's conversation notes, places, things seen and to-dos. */
export default function RecapScreen() {
  const { day } = useLocalSearchParams<{ day?: string }>();
  const [r, setR] = useState<DayRecap | null>(null);
  useEffect(() => {
    void buildDayRecap(day ? Number(day) : Date.now()).then(setR);
  }, [day]);
  if (!r) return null;
  const title = new Date(r.day).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <ScrollView contentContainerStyle={local.container}>
      <Stack.Screen options={{ title: 'Your day' }} />
      <Text style={styles.h}>{title}</Text>
      {isEmptyRecap(r) && <Text style={styles.hint}>Nothing remembered this day.</Text>}
      {r.notes.length > 0 && (
        <Section title="Conversations">
          {r.notes.map((n) => (
            <Pressable key={n.id} onPress={() => router.push(`/note/${n.id}`)} style={styles.item}>
              <Text style={styles.label}>
                {time(n.at)} · {n.title}
              </Text>
              <Text style={styles.hint} numberOfLines={3}>
                {n.text}
              </Text>
            </Pressable>
          ))}
        </Section>
      )}
      {r.places.length > 0 && (
        <Section title="Places">
          <Text style={styles.body}>{r.places.join(' · ')}</Text>
        </Section>
      )}
      {r.seen.length > 0 && (
        <Section title="Things seen">
          {r.seen.map((s) => (
            <Text key={s.id} style={styles.body} numberOfLines={2}>
              {time(s.at)} · {s.text}
            </Text>
          ))}
        </Section>
      )}
      {(r.done.length > 0 || r.pending.length > 0) && (
        <Section title="To-dos">
          {r.done.map((t, i) => (
            <Text key={`d${i}`} style={styles.body}>
              ✓ {t}
            </Text>
          ))}
          {r.pending.map((t, i) => (
            <Text key={`p${i}`} style={styles.body}>
              ○ {t}
            </Text>
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

const local = StyleSheet.create({ container: { padding: 16, gap: 10 } });

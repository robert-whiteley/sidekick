import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, confirm, formatTime, Section, styles } from '@/features/settings/ui';
import {
  acceptSuggestedName,
  deleteMoment,
  deleteSpeaker,
  dismissSuggestedName,
  getSpeaker,
  type Moment,
  nameSpeaker,
  speakerMoments,
} from '@/memory/store';

type Person = NonNullable<Awaited<ReturnType<typeof getSpeaker>>>;

/** One person: their name, whether they agreed to notes, and what Sidekick kept of them. */
export default function PersonScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const [person, setPerson] = useState<Person | null>(null);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([getSpeaker(id), speakerMoments(id)]);
      setPerson(p);
      setName(p?.name ?? '');
      setMoments(m);
    } catch (e) {
      console.log(`[person] unavailable: ${String(e)}`);
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (!loaded) return null;
  if (!person) {
    return (
      <View style={local.container}>
        <Text style={styles.body}>This person was deleted.</Text>
      </View>
    );
  }

  const label = person.isOwner ? 'You' : (person.name ?? `Voice ${person.id}`);
  const saveName = async () => {
    await nameSpeaker(person.id, name);
    await reload();
  };

  return (
    <ScrollView contentContainerStyle={local.container}>
      <Stack.Screen options={{ title: label }} />
      {!person.isOwner && (
        <Section title="Name">
          <View style={styles.itemRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={name}
              onChangeText={setName}
              onSubmitEditing={() => void saveName()}
              placeholder="Name"
              accessibilityLabel="Name"
            />
            <Pressable onPress={() => void saveName()}>
              <Text style={styles.link}>Save</Text>
            </Pressable>
          </View>
          {person.suggestedName && (
            <View style={styles.itemRow}>
              <Text style={[styles.body, styles.flex]}>Is this {person.suggestedName}?</Text>
              <Pressable
                onPress={async () => {
                  await acceptSuggestedName(person.id);
                  await reload();
                }}
              >
                <Text style={styles.link}>Yes</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  await dismissSuggestedName(person.id);
                  await reload();
                }}
              >
                <Text style={styles.link}>No</Text>
              </Pressable>
            </View>
          )}
          <Text style={styles.hint}>
            {person.consented
              ? 'Agreed to notes: what they say is remembered.'
              : 'Has not agreed to notes. With consent mode on, what they say is not kept.'}
          </Text>
        </Section>
      )}
      <Section title={`Memories (${person.moments})`}>
        {moments.length === 0 && <Text style={styles.hint}>Nothing kept.</Text>}
        {moments.map((m) => (
          <View key={m.id} style={styles.item}>
            <View style={styles.itemRow}>
              <Text style={[styles.small, styles.flex]}>{formatTime(m.at)}</Text>
              <Pressable
                onPress={async () => {
                  await deleteMoment(m.id);
                  await reload();
                }}
              >
                <Text style={[styles.link, styles.danger]}>Delete</Text>
              </Pressable>
            </View>
            <Text style={styles.body}>{m.text}</Text>
          </View>
        ))}
      </Section>
      <Button
        title={`Delete ${label} and everything they said`}
        danger
        onPress={() =>
          confirm(
            `Delete ${label}?`,
            'This deletes this voice and everything they said.',
            async () => {
              await deleteSpeaker(person.id);
              router.back();
            },
          )
        }
      />
    </ScrollView>
  );
}

const local = StyleSheet.create({
  container: { padding: 16, gap: 8, paddingBottom: 48 },
});

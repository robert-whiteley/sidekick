import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  acceptSuggestedName,
  deleteSpeaker,
  dismissSuggestedName,
  listSpeakers,
  nameSpeaker,
} from '@/memory/store';
import { speakerLabel } from '@/memory/people-logic';
import { confirm, Section, styles } from './ui';

export type Person = Awaited<ReturnType<typeof listSpeakers>>[number];

export function PeopleSection({ people, onChanged }: { people: Person[]; onChanged: () => void }) {
  return (
    <Section title="People">
      {people.length === 0 ? (
        <Text style={styles.hint}>No voices yet. They appear as Sidekick hears people.</Text>
      ) : (
        people.map((p) => <PersonRow key={p.id} person={p} onChanged={onChanged} />)
      )}
    </Section>
  );
}

function PersonRow({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name ?? '');
  const label = `${speakerLabel(person)}${person.nameAuto ? ' (auto)' : ''}`;

  const save = async () => {
    await nameSpeaker(person.id, name);
    setEditing(false);
    onChanged();
  };

  return (
    <View style={styles.item}>
      <View style={styles.itemRow}>
        {editing ? (
          <TextInput
            style={[styles.input, styles.flex]}
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => void save()}
            placeholder="Name"
            autoFocus
          />
        ) : (
          <Pressable
            style={styles.flex}
            accessibilityRole="link"
            onPress={() =>
              router.push({ pathname: '/person/[id]', params: { id: String(person.id) } })
            }
          >
            <Text style={[styles.body, styles.link]}>{label}</Text>
          </Pressable>
        )}
        {!person.isOwner &&
          (editing ? (
            <Pressable onPress={() => void save()}>
              <Text style={styles.link}>Save</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setEditing(true)}>
              <Text style={styles.link}>Rename</Text>
            </Pressable>
          ))}
        <Pressable
          onPress={() =>
            confirm(
              `Delete ${label}?`,
              'This deletes this voice and everything they said.',
              async () => {
                await deleteSpeaker(person.id);
                onChanged();
              },
            )
          }
        >
          <Text style={[styles.link, styles.danger]}>Delete</Text>
        </Pressable>
      </View>
      {person.suggestedName && !person.isOwner && (
        <View style={styles.itemRow}>
          <Text style={[styles.body, styles.flex]}>Is this {person.suggestedName}?</Text>
          <Pressable
            onPress={async () => {
              await acceptSuggestedName(person.id);
              onChanged();
            }}
          >
            <Text style={styles.link}>Yes</Text>
          </Pressable>
          <Pressable
            onPress={async () => {
              await dismissSuggestedName(person.id);
              onChanged();
            }}
          >
            <Text style={styles.link}>No</Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.small}>
        {person.moments} {person.moments === 1 ? 'memory' : 'memories'}
        {!person.isOwner && (person.consented ? ' · agreed to notes' : '')}
      </Text>
    </View>
  );
}

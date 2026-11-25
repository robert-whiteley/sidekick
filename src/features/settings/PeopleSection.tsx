import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  acceptSuggestedName,
  deleteSpeaker,
  dismissSuggestedName,
  listSpeakers,
  nameSpeaker,
} from '@/memory/store';
import { speakerLabel } from '@/memory/people-logic';
import { confirm, Section, styles } from './ui';
import { AppText, Tappable, TextButton, TextField } from '@/ui';

export type Person = Awaited<ReturnType<typeof listSpeakers>>[number];

export function PeopleSection({ people, onChanged }: { people: Person[]; onChanged: () => void }) {
  return (
    <Section title="People">
      {people.length === 0 ? (
        <AppText variant="bodySmall" tone="muted">
          No voices yet. They appear as Sidekick hears people.
        </AppText>
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
          <TextField
            containerStyle={styles.flex}
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => void save()}
            placeholder="Name"
            autoFocus
          />
        ) : (
          <Tappable
            style={[styles.flex, styles.tapRow]}
            accessibilityRole="link"
            onPress={() =>
              router.push({ pathname: '/person/[id]', params: { id: String(person.id) } })
            }
          >
            <AppText tone="primary">{label}</AppText>
          </Tappable>
        )}
        {!person.isOwner &&
          (editing ? (
            <TextButton title="Save" onPress={() => void save()} />
          ) : (
            <TextButton title="Rename" onPress={() => setEditing(true)} />
          ))}
        <TextButton
          title="Delete"
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
          danger
        />
      </View>
      {person.suggestedName && !person.isOwner && (
        <View style={styles.itemRow}>
          <AppText style={styles.flex}>Is this {person.suggestedName}?</AppText>
          <TextButton
            title="Yes"
            onPress={async () => {
              await acceptSuggestedName(person.id);
              onChanged();
            }}
          />
          <TextButton
            title="No"
            onPress={async () => {
              await dismissSuggestedName(person.id);
              onChanged();
            }}
          />
        </View>
      )}
      <AppText variant="bodySmall" tone="muted">
        {person.moments} {person.moments === 1 ? 'memory' : 'memories'}
        {!person.isOwner && (person.consented ? ' · agreed to notes' : '')}
      </AppText>
    </View>
  );
}

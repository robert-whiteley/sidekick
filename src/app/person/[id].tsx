import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, confirm, formatTime, Section, styles } from '@/features/settings/ui';
import {
  acceptSuggestedName,
  deleteFact,
  deleteMoment,
  deleteSpeaker,
  dismissSuggestedName,
  getSpeaker,
  listSpeakers,
  type Moment,
  nameSpeaker,
  speakerMoments,
} from '@/memory/store';
import { contactNameMatches } from '@/memory/names';
import { contactNames } from '@/memory/sources';
import { formatDue, type Followup } from '@/memory/followup-logic';
import { dismissFollowup, updateFollowup } from '@/memory/followups';
import { speakerLabel, type ConversationSummary } from '@/memory/people-logic';
import {
  approvePersonFact,
  confirmAutoName,
  personConversations,
  personFacts,
  type PersonFact,
  personRequests,
  setPersonNotes,
  undoAutoName,
} from '@/memory/people';

type Person = NonNullable<Awaited<ReturnType<typeof getSpeaker>>>;

/** One person: their name, whether they agreed to notes, and what Sidekick kept of them. */
export default function PersonScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const [person, setPerson] = useState<Person | null>(null);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [contacts, setContacts] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [facts, setFacts] = useState<PersonFact[]>([]);
  const [requests, setRequests] = useState<Followup[]>([]);
  const [talks, setTalks] = useState<ConversationSummary[]>([]);
  const [labels, setLabels] = useState<Map<number, string>>(new Map());

  const reload = useCallback(async () => {
    try {
      const [p, m, c, f, r, t, all] = await Promise.all([
        getSpeaker(id),
        speakerMoments(id),
        contactNames().catch(() => []),
        personFacts(id),
        personRequests(id),
        personConversations(id),
        listSpeakers(),
      ]);
      setContacts(c);
      setPerson(p);
      setName(p?.name ?? '');
      setNotes(p?.notes ?? '');
      setMoments(m);
      setFacts(f);
      setRequests(r);
      setTalks(t);
      setLabels(new Map(all.map((x) => [x.id, speakerLabel(x)])));
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

  const label = speakerLabel(person);
  const now = new Date();
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
          {name !== (person.name ?? '') && contactNameMatches(name, contacts).length > 0 && (
            <View style={styles.chips}>
              {contactNameMatches(name, contacts).map((c) => (
                <Pressable
                  key={c}
                  style={styles.chip}
                  onPress={() => setName(c)}
                  accessibilityLabel={`Use contact ${c}`}
                >
                  <Text style={styles.chipText}>{c}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {person.nameAuto && (
            <View style={styles.itemRow}>
              <Text style={[styles.hint, styles.flex]}>
                Named automatically (they said their name).
              </Text>
              <Pressable
                onPress={async () => {
                  await confirmAutoName(person.id);
                  await reload();
                }}
              >
                <Text style={styles.link}>Keep</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  await undoAutoName(person.id);
                  await reload();
                }}
              >
                <Text style={styles.link}>Undo</Text>
              </Pressable>
            </View>
          )}
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
      {!person.isOwner && (
        <Section title="Notes">
          <TextInput
            style={[styles.input, local.notes]}
            value={notes}
            onChangeText={setNotes}
            onEndEditing={() => void setPersonNotes(person.id, notes)}
            placeholder={`Anything to remember about ${label}`}
            accessibilityLabel="Notes"
            multiline
          />
          {notes !== person.notes && (
            <Pressable
              onPress={async () => {
                await setPersonNotes(person.id, notes);
                await reload();
              }}
            >
              <Text style={styles.link}>Save notes</Text>
            </Pressable>
          )}
        </Section>
      )}
      {!person.isOwner && (
        <Section title="Asked of them">
          {requests.length === 0 && (
            <Text style={styles.hint}>
              Nothing yet. When you say e.g. &quot;{label}, can you send the report by Friday?&quot;
              it shows here.
            </Text>
          )}
          {requests.map((f) => (
            <View key={f.id} style={styles.item}>
              <Text style={[styles.body, f.status === 'done' && local.done]}>
                {f.title}
                {formatDue(f, now) ? ` · ${formatDue(f, now)}` : ''}
              </Text>
              <View style={styles.itemRow}>
                <Text style={[styles.small, styles.flex]}>
                  {f.status === 'suggested' ? 'Not tracked yet' : f.status}
                </Text>
                {f.status === 'suggested' && (
                  <Pressable
                    onPress={async () => {
                      await updateFollowup(f.id, { status: 'approved' });
                      await reload();
                    }}
                  >
                    <Text style={styles.link}>Track</Text>
                  </Pressable>
                )}
                {f.status !== 'done' && (
                  <Pressable
                    onPress={async () => {
                      await updateFollowup(f.id, { status: 'done' });
                      await reload();
                    }}
                  >
                    <Text style={styles.link}>Done</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={async () => {
                    await dismissFollowup(f.id);
                    await reload();
                  }}
                >
                  <Text style={[styles.link, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </Section>
      )}
      {!person.isOwner && (
        <Section title="About them">
          {facts.length === 0 && (
            <Text style={styles.hint}>
              Things they say about themselves (&quot;I live in Leeds&quot;) are suggested here.
            </Text>
          )}
          {facts.map((f) => (
            <View key={f.id} style={styles.itemRow}>
              <Text style={[styles.body, styles.flex, f.status === 'suggested' && local.done]}>
                &quot;{f.text}&quot;
              </Text>
              {f.status === 'suggested' && (
                <Pressable
                  onPress={async () => {
                    await approvePersonFact(f.id);
                    await reload();
                  }}
                >
                  <Text style={styles.link}>Keep</Text>
                </Pressable>
              )}
              <Pressable
                onPress={async () => {
                  await deleteFact(f.id);
                  await reload();
                }}
              >
                <Text style={[styles.link, styles.danger]}>
                  {f.status === 'suggested' ? 'No' : 'Delete'}
                </Text>
              </Pressable>
            </View>
          ))}
          {facts.some((f) => f.status === 'suggested') && (
            <Text style={styles.hint}>Only kept facts are used in answers.</Text>
          )}
        </Section>
      )}
      {!person.isOwner && talks.length > 0 && (
        <Section title="Recent conversations">
          {talks.map((t) => (
            <View key={t.from} style={styles.item}>
              <Text style={styles.small}>
                {formatTime(t.from)} · {t.lines.length} lines
              </Text>
              {t.lines.slice(-4).map((l) => (
                <Text key={l.id} style={styles.body} numberOfLines={2}>
                  <Text style={local.who}>
                    {l.speakerId != null ? (labels.get(l.speakerId) ?? 'Someone') : 'Someone'}:{' '}
                  </Text>
                  {l.text}
                </Text>
              ))}
            </View>
          ))}
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
  notes: { minHeight: 72, textAlignVertical: 'top' },
  done: { color: '#888' },
  who: { fontWeight: '600' },
});

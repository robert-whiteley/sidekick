import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

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
import { AppText, Page, TextButton, TextField } from '@/ui';

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
      <Page title="Person">
        <AppText>This person was deleted.</AppText>
      </Page>
    );
  }

  const label = speakerLabel(person);
  const now = new Date();
  const saveName = async () => {
    await nameSpeaker(person.id, name);
    await reload();
  };

  return (
    <Page title={label}>
      {!person.isOwner && (
        <Section title="Name">
          <View style={styles.itemRow}>
            <TextField
              containerStyle={styles.flex}
              value={name}
              onChangeText={setName}
              onSubmitEditing={() => void saveName()}
              placeholder="Name"
              accessibilityLabel="Name"
            />
            <TextButton title="Save" onPress={() => void saveName()} />
          </View>
          {name !== (person.name ?? '') && contactNameMatches(name, contacts).length > 0 && (
            <View style={styles.actions}>
              {contactNameMatches(name, contacts).map((c) => (
                <TextButton
                  key={c}
                  title={`Use ${c}`}
                  onPress={() => setName(c)}
                  accessibilityLabel={`Use contact ${c}`}
                />
              ))}
            </View>
          )}
          {person.nameAuto && (
            <View style={styles.itemRow}>
              <AppText variant="bodySmall" tone="muted" style={styles.flex}>
                Named automatically (they said their name).
              </AppText>
              <TextButton
                title="Keep"
                onPress={async () => {
                  await confirmAutoName(person.id);
                  await reload();
                }}
              />
              <TextButton
                title="Undo"
                onPress={async () => {
                  await undoAutoName(person.id);
                  await reload();
                }}
              />
            </View>
          )}
          {person.suggestedName && (
            <View style={styles.itemRow}>
              <AppText style={styles.flex}>Is this {person.suggestedName}?</AppText>
              <TextButton
                title="Yes"
                onPress={async () => {
                  await acceptSuggestedName(person.id);
                  await reload();
                }}
              />
              <TextButton
                title="No"
                onPress={async () => {
                  await dismissSuggestedName(person.id);
                  await reload();
                }}
              />
            </View>
          )}
          <AppText variant="bodySmall" tone="muted">
            {person.consented
              ? 'Agreed to notes: what they say is remembered.'
              : 'Has not agreed to notes. With consent mode on, what they say is not kept.'}
          </AppText>
        </Section>
      )}
      {!person.isOwner && (
        <Section title="Notes">
          <TextField
            style={local.notes}
            value={notes}
            onChangeText={setNotes}
            onEndEditing={() => void setPersonNotes(person.id, notes)}
            placeholder={`Anything to remember about ${label}`}
            accessibilityLabel="Notes"
            multiline
          />
          {notes !== person.notes && (
            <TextButton
              title="Save notes"
              onPress={async () => {
                await setPersonNotes(person.id, notes);
                await reload();
              }}
            />
          )}
        </Section>
      )}
      {!person.isOwner && (
        <Section title="Asked of them">
          {requests.length === 0 && (
            <AppText variant="bodySmall" tone="muted">
              Nothing yet. When you say e.g. &quot;{label}, can you send the report by Friday?&quot;
              it shows here.
            </AppText>
          )}
          {requests.map((f) => (
            <View key={f.id} style={styles.item}>
              <AppText tone={f.status === 'done' ? 'muted' : 'default'}>
                {f.title}
                {formatDue(f, now) ? ` · ${formatDue(f, now)}` : ''}
              </AppText>
              <View style={styles.itemRow}>
                <AppText variant="bodySmall" tone="muted" style={styles.flex}>
                  {f.status === 'suggested' ? 'Not tracked yet' : f.status}
                </AppText>
                {f.status === 'suggested' && (
                  <TextButton
                    title="Track"
                    onPress={async () => {
                      await updateFollowup(f.id, { status: 'approved' });
                      await reload();
                    }}
                  />
                )}
                {f.status !== 'done' && (
                  <TextButton
                    title="Done"
                    onPress={async () => {
                      await updateFollowup(f.id, { status: 'done' });
                      await reload();
                    }}
                  />
                )}
                <TextButton
                  title="Remove"
                  onPress={async () => {
                    await dismissFollowup(f.id);
                    await reload();
                  }}
                  danger
                />
              </View>
            </View>
          ))}
        </Section>
      )}
      {!person.isOwner && (
        <Section title="About them">
          {facts.length === 0 && (
            <AppText variant="bodySmall" tone="muted">
              Things they say about themselves (&quot;I live in Leeds&quot;) are suggested here.
            </AppText>
          )}
          {facts.map((f) => (
            <View key={f.id} style={styles.itemRow}>
              <AppText style={styles.flex} tone={f.status === 'suggested' ? 'muted' : 'default'}>
                &quot;{f.text}&quot;
              </AppText>
              {f.status === 'suggested' && (
                <TextButton
                  title="Keep"
                  onPress={async () => {
                    await approvePersonFact(f.id);
                    await reload();
                  }}
                />
              )}
              <TextButton
                title={f.status === 'suggested' ? 'No' : 'Delete'}
                onPress={async () => {
                  await deleteFact(f.id);
                  await reload();
                }}
                danger
              />
            </View>
          ))}
          {facts.some((f) => f.status === 'suggested') && (
            <AppText variant="bodySmall" tone="muted">
              Only kept facts are used in answers.
            </AppText>
          )}
        </Section>
      )}
      {!person.isOwner && talks.length > 0 && (
        <Section title="Recent conversations">
          {talks.map((t) => (
            <View key={t.from} style={styles.item}>
              <AppText variant="bodySmall" tone="muted">
                {formatTime(t.from)} · {t.lines.length} lines
              </AppText>
              {t.lines.slice(-4).map((l) => (
                <AppText key={l.id} numberOfLines={2}>
                  <AppText variant="bodyStrong">
                    {l.speakerId != null ? (labels.get(l.speakerId) ?? 'Someone') : 'Someone'}:{' '}
                  </AppText>
                  {l.text}
                </AppText>
              ))}
            </View>
          ))}
        </Section>
      )}
      <Section title={`Memories (${person.moments})`}>
        {moments.length === 0 && (
          <AppText variant="bodySmall" tone="muted">
            Nothing kept.
          </AppText>
        )}
        {moments.map((m) => (
          <View key={m.id} style={styles.item}>
            <View style={styles.itemRow}>
              <AppText variant="bodySmall" tone="muted" style={styles.flex}>
                {formatTime(m.at)}
              </AppText>
              <TextButton
                title="Delete"
                onPress={async () => {
                  await deleteMoment(m.id);
                  await reload();
                }}
                danger
              />
            </View>
            <AppText>{m.text}</AppText>
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
    </Page>
  );
}

const local = StyleSheet.create({
  notes: { minHeight: 72, textAlignVertical: 'top' },
});

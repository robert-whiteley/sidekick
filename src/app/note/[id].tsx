import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, confirm, Section, styles } from '@/features/settings/ui';
import type { HeardLine } from '@/memory/conversation-note-logic';
import { getNote, noteLines, type StoredNote } from '@/memory/conversation-notes';
import { deleteMoment } from '@/memory/store';

/** A note this recent may still be updating (its conversation is going on). */
const LIVE_MS = 10 * 60_000;

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** One live conversation note, with what was said during it (refreshes while it goes on). */
export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [note, setNote] = useState<StoredNote | null | undefined>(undefined);
  const [lines, setLines] = useState<HeardLine[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      getNote(Number(id)).then(async (n) => {
        if (!live) return;
        setNote(n);
        if (n) setLines(await noteLines(n));
        return n;
      });
    // A conversation still going on: its note updates while the page is open.
    let timer: ReturnType<typeof setInterval> | null = null;
    void load().then((n) => {
      if (live && n && Date.now() - n.to < LIVE_MS) timer = setInterval(() => void load(), 15_000);
    });
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [id]);
  if (note === undefined) return null;
  if (!note)
    return (
      <View style={local.container}>
        <Stack.Screen options={{ title: 'Notes' }} />
        <Text style={styles.hint}>This note was deleted.</Text>
      </View>
    );
  const [title, ...rest] = note.text.split('\n');
  const day = new Date(note.from).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return (
    <ScrollView contentContainerStyle={local.container}>
      <Stack.Screen options={{ title: 'Conversation notes' }} />
      <Text style={styles.h}>{title}</Text>
      <Text style={styles.hint}>
        {day}, {time(note.from)}–{time(note.to)}
      </Text>
      {rest.map((l, i) => (
        <Text key={i} style={styles.body}>
          {l}
        </Text>
      ))}
      <Text style={styles.hint}>
        Action items are offered as follow-ups in Memory › To-dos; nothing is used until you approve
        it.
      </Text>
      <Section title="What was said">
        {lines.length === 0 && <Text style={styles.hint}>The lines were deleted.</Text>}
        {lines.map((l) => (
          <Text key={l.id} style={styles.body}>
            <Text style={styles.small}>
              {time(l.at)} {l.who === 'Me' ? 'You' : l.who}:{' '}
            </Text>
            {l.text}
          </Text>
        ))}
      </Section>
      <Button
        danger
        title="Delete this note"
        onPress={() =>
          confirm('Delete this note?', 'What was said stays in your memory.', async () => {
            await deleteMoment(note.id);
            router.back();
          })
        }
      />
    </ScrollView>
  );
}

const local = StyleSheet.create({ container: { padding: 16, gap: 10 } });

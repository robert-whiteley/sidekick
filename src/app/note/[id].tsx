import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { Button, confirm, Section } from '@/features/settings/ui';
import type { HeardLine } from '@/memory/conversation-note-logic';
import { getNote, noteLines, type StoredNote } from '@/memory/conversation-notes';
import { deleteMoment } from '@/memory/store';
import { AppText, Page } from '@/ui';

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
      <Page title="Notes">
        <AppText variant="bodySmall" tone="muted">
          This note was deleted.
        </AppText>
      </Page>
    );
  const [title, ...rest] = note.text.split('\n');
  const day = new Date(note.from).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return (
    <Page title="Conversation notes">
      <AppText variant="titleSmall">{title}</AppText>
      <AppText variant="bodySmall" tone="muted">
        {day}, {time(note.from)}–{time(note.to)}
      </AppText>
      {rest.map((l, i) => (
        <AppText key={i}>{l}</AppText>
      ))}
      <AppText variant="bodySmall" tone="muted">
        Action items are offered as follow-ups in Memory › To-dos; nothing is used until you approve
        it.
      </AppText>
      <Section title="What was said">
        {lines.length === 0 && (
          <AppText variant="bodySmall" tone="muted">
            The lines were deleted.
          </AppText>
        )}
        {lines.map((l) => (
          <AppText key={l.id}>
            <AppText variant="bodySmall" tone="muted">
              {time(l.at)} {l.who === 'Me' ? 'You' : l.who}:{' '}
            </AppText>
            {l.text}
          </AppText>
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
    </Page>
  );
}

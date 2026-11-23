import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { getSettings, onSettingsChange, type Settings, updateSettings } from '@/engine/settings';
import {
  addNote,
  clearContacts,
  countKind,
  deleteSource,
  folderLabel,
  notificationAccessGranted,
  openNotificationAccess,
  pickFolder,
  removeFolder,
  requestCalendar,
  requestContacts,
  setNotificationCapture,
  syncNow,
} from '@/memory/sources';
import { Button, confirm, Row, Section, styles } from './ui';

const isAndroid = Platform.OS === 'android';

function useSettings(): Settings {
  const [s, setS] = useState(getSettings());
  useEffect(() => onSettingsChange(setS), []);
  return s;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Your data sources": each off until turned on, each with its own permission. */
export function SourcesSection({ onChanged }: { onChanged: () => void }) {
  const s = useSettings();
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [notifAccess, setNotifAccess] = useState(notificationAccessGranted());
  const [counts, setCounts] = useState({ note: 0, file: 0, event: 0, notification: 0 });

  const refresh = useCallback(async () => {
    try {
      const [note, file, event, notification] = await Promise.all([
        countKind('note'),
        countKind('file'),
        countKind('event'),
        countKind('notification'),
      ]);
      setCounts({ note, file, event, notification });
    } catch (e) {
      console.log(`[sources] counts: ${String(e)}`);
    }
    setNotifAccess(notificationAccessGranted());
  }, []);

  // Coming back from the system's notification-access screen.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const sub = AppState.addEventListener('change', (st) => {
        if (st === 'active') void refresh();
      });
      return () => sub.remove();
    }, [refresh]),
  );

  const run = async (label: string, fn: () => Promise<number | void>) => {
    setMsg(`${label}…`);
    try {
      await fn();
      setMsg('');
    } catch (e) {
      setMsg(`${label} failed: ${errText(e)}`);
    }
    await refresh();
    onChanged();
  };

  const toggleContacts = async (on: boolean) => {
    if (!on) {
      updateSettings({ sourceContacts: false });
      await clearContacts();
      return;
    }
    if (!(await requestContacts())) {
      setMsg('Contacts permission was not given.');
      return;
    }
    updateSettings({ sourceContacts: true });
    await run('Reading contacts', () => syncNow('contacts'));
  };

  const toggleCalendar = async (on: boolean) => {
    if (!on) {
      updateSettings({ sourceCalendar: false });
      return;
    }
    if (!(await requestCalendar())) {
      setMsg('Calendar permission was not given.');
      return;
    }
    updateSettings({ sourceCalendar: true });
    await run('Reading calendar', () => syncNow('calendar'));
  };

  const toggleNotifications = (on: boolean) => {
    updateSettings({ sourceNotifications: on });
    setNotificationCapture(on);
    if (on && !notificationAccessGranted()) openNotificationAccess();
  };

  const saveNote = async () => {
    if (!note.trim()) return;
    await addNote(note);
    setNote('');
    await refresh();
    onChanged();
  };

  return (
    <Section title="Your data sources">
      <Text style={styles.hint}>
        Extra things Sidekick can remember and search. Each is off until you turn it on, and
        everything stays encrypted on this phone.
      </Text>

      <Row
        label="Notes"
        hint={`Type notes for Sidekick to remember. ${counts.note} saved.`}
        value={s.sourceNotes}
        onChange={(v) => updateSettings({ sourceNotes: v })}
      />
      {s.sourceNotes && (
        <View style={styles.itemRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={note}
            onChangeText={setNote}
            onSubmitEditing={() => void saveNote()}
            placeholder="Write a note"
            accessibilityLabel="New note"
            multiline
          />
          <Pressable onPress={() => void saveNote()} accessibilityRole="button">
            <Text style={styles.link}>Save</Text>
          </Pressable>
        </View>
      )}

      <Row
        label="Folders"
        hint={`Text files (.txt, .md) in folders you pick; re-read every 15 minutes while Sidekick is open. PDFs are not read yet. ${counts.file} passages indexed.`}
        value={s.sourceFolders}
        onChange={(v) => {
          updateSettings({ sourceFolders: v });
          if (v && !s.folderUris.length)
            void run('Adding folder', async () => void (await pickFolder()));
        }}
      />
      {s.sourceFolders && (
        <>
          {s.folderUris.map((uri) => (
            <View key={uri} style={styles.itemRow}>
              <Text style={[styles.body, styles.flex]} numberOfLines={1}>
                {folderLabel(uri)}
              </Text>
              <Pressable
                onPress={() =>
                  confirm(
                    'Remove this folder?',
                    'What Sidekick read from it is deleted. Your files are not touched.',
                    () => run('Removing folder', () => removeFolder(uri)),
                  )
                }
                accessibilityLabel={`Remove folder ${folderLabel(uri)}`}
              >
                <Text style={[styles.link, styles.danger]}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <Button
            title="Add a folder"
            onPress={() =>
              void run('Adding folder', async () => {
                if (await pickFolder()) await syncNow('folders');
              })
            }
          />
          {s.folderUris.length > 0 && (
            <Button
              title="Re-read folders now"
              onPress={() => void run('Reading folders', () => syncNow('folders'))}
            />
          )}
        </>
      )}

      <Row
        label="Contacts"
        hint="Answers “what’s Sam’s number” and helps name voices. Read only."
        value={s.sourceContacts}
        onChange={(v) => void toggleContacts(v)}
      />

      <Row
        label="Calendar"
        hint={`Events from the past and coming year, so “when is my dentist” works. Read only. ${counts.event} events.`}
        value={s.sourceCalendar}
        onChange={(v) => void toggleCalendar(v)}
      />

      {isAndroid && (
        <>
          <Row
            label="Notifications"
            hint={`Keeps the text of other apps’ notifications (one-time codes are skipped). ${counts.notification} kept.`}
            value={s.sourceNotifications}
            onChange={toggleNotifications}
          />
          {s.sourceNotifications && !notifAccess && (
            <>
              <Text style={styles.hint}>
                Android needs you to allow “Sidekick memory” under Notification access.
              </Text>
              <Button title="Open notification access" onPress={openNotificationAccess} />
            </>
          )}
        </>
      )}
      {msg ? <Text style={styles.hint}>{msg}</Text> : null}
    </Section>
  );
}

const SOURCES = [
  { id: 'notes', label: 'notes' },
  { id: 'folders', label: 'files read from folders' },
  { id: 'calendar', label: 'calendar events' },
  { id: 'contacts', label: 'contacts copy' },
  { id: 'notifications', label: 'notifications' },
] as const;

/** Data control: delete everything one source added. */
export function DeleteBySource({ onChanged }: { onChanged: () => void }) {
  return (
    <>
      {SOURCES.filter((x) => isAndroid || x.id !== 'notifications').map((x) => (
        <Button
          key={x.id}
          danger
          title={`Delete ${x.label}`}
          onPress={() =>
            confirm(
              `Delete ${x.label}?`,
              'Everything Sidekick kept from this source is deleted and the source is turned off. The originals on your phone are not touched.',
              async () => {
                await deleteSource(x.id);
                onChanged();
              },
            )
          }
        />
      ))}
    </>
  );
}

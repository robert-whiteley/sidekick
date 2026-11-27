import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';

import { getSettings, onSettingsChange, type Settings, updateSettings } from '@/engine/settings';
import {
  addNote,
  clearContacts,
  countKind,
  deleteSource,
  notificationAccessGranted,
  openNotificationAccess,
  requestCalendar,
  requestContacts,
  setNotificationCapture,
  syncNow,
} from '@/memory/sources';
import { Button, confirm, NavRow, Row, Section, styles } from './ui';
import { AppText, TextButton, TextField } from '@/ui';

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
      <AppText variant="bodySmall" tone="muted">
        Extra things Sidekick can remember and search. Each is off until you turn it on, and
        everything stays encrypted on this phone.
      </AppText>

      <Row
        label="Notes"
        hint={`Type notes for Sidekick to remember. ${counts.note} saved.`}
        value={s.sourceNotes}
        onChange={(v) => updateSettings({ sourceNotes: v })}
      />
      {s.sourceNotes && (
        <View style={styles.itemRow}>
          <TextField
            containerStyle={styles.flex}
            value={note}
            onChangeText={setNote}
            onSubmitEditing={() => void saveNote()}
            placeholder="Write a note"
            accessibilityLabel="New note"
            multiline
          />
          <TextButton title="Save" onPress={() => void saveNote()} />
        </View>
      )}

      <NavRow
        label="Folders and photos"
        hint={`Folders, files and photos Sidekick may search, in Phone search. ${counts.file} passages read.`}
        href="/settings/phone-search"
      />

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
              <AppText variant="bodySmall" tone="muted">
                Android needs you to allow “Sidekick memory” under Notification access.
              </AppText>
              <Button title="Open notification access" onPress={openNotificationAccess} />
            </>
          )}
        </>
      )}
      {msg ? (
        <AppText variant="bodySmall" tone="muted">
          {msg}
        </AppText>
      ) : null}
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

import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  addToCalendar,
  allowExactReminders,
  askNotificationPermission,
  exactRemindersAllowed,
} from '@/engine/followup-notify';
import { getSettings, updateSettings } from '@/engine/settings';
import {
  type Followup,
  type FollowupKind,
  formatDue,
  kindLabel,
  parseWhen,
} from '@/memory/followup-logic';
import {
  deleteFollowup,
  dismissFollowup,
  listFollowups,
  onFollowupsChange,
  updateFollowup,
} from '@/memory/followups';
import { NavRow, Row, Section, styles } from './ui';
import { AppText, ListRow, Segmented, TextButton, TextField } from '@/ui';

const KINDS: FollowupKind[] = ['todo', 'event', 'reminder'];

/** Suggested and approved to-dos, events and reminders; nothing happens until approved. */
export function FollowupsSection({ part = 'both' }: { part?: 'settings' | 'list' | 'both' }) {
  const showSettings = part !== 'list';
  const showList = part !== 'settings';
  const [items, setItems] = useState<Followup[]>([]);
  const [suggest, setSuggest] = useState(getSettings().suggestFollowups);
  const [exact, setExact] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const reload = useCallback(() => {
    listFollowups()
      .then(setItems)
      .catch((e) => console.log(`[followups] unavailable: ${String(e)}`));
  }, []);
  useEffect(() => {
    reload();
    exactRemindersAllowed()
      .then(setExact)
      .catch(() => {});
    return onFollowupsChange(reload);
  }, [reload]);

  const approve = async (f: Followup) => {
    if (f.kind === 'reminder' && f.dueAt == null) {
      setEditing(f.id);
      setMsg('Add a time for this reminder first.');
      return;
    }
    await updateFollowup(f.id, { status: 'approved' });
    if (f.kind === 'reminder' && !(await askNotificationPermission())) {
      setMsg('Notifications are off for Sidekick, so this reminder will not alert you.');
    }
  };

  const toCalendar = async (f: Followup) => {
    try {
      await addToCalendar(f);
    } catch (e) {
      setMsg(`Couldn't open the calendar: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const suggested = items.filter((f) => f.status === 'suggested');
  const approved = items.filter((f) => f.status === 'approved');
  const done = items.filter((f) => f.status === 'done');
  const now = new Date();

  const line = (f: Followup) => {
    const due = formatDue(f, now);
    return (
      <AppText style={styles.flex} tone={f.status === 'done' ? 'muted' : 'default'}>
        {`${kindLabel(f.kind)}: ${f.personName ? `${f.personName} — ` : ''}${f.title}${due ? ` · ${due}` : f.whenText ? ` · "${f.whenText}"` : ''}`}
      </AppText>
    );
  };

  return (
    <Section title={part === 'list' ? 'To-dos and reminders' : 'Follow-ups'}>
      {showSettings && (
        <Row
          label="Suggest follow-ups"
          hint="Proposes to-dos, events and reminders from what is said. Nothing is used until you approve it."
          value={suggest}
          onChange={(v) => {
            setSuggest(v);
            updateSettings({ suggestFollowups: v });
          }}
        />
      )}
      {showSettings && (
        <NavRow
          label="Routines"
          hint='Things Sidekick does by itself at a time or when something happens, e.g. "every weekday at 8 brief me".'
          href="/settings/routines"
        />
      )}
      {showSettings && !exact && (
        <ListRow
          title="Allow exact reminder times"
          supporting="Otherwise Android may deliver reminders late."
          navigates
          onPress={() =>
            void allowExactReminders()
              .then(setExact)
              .catch(() => {})
          }
        />
      )}
      {msg ? (
        <AppText variant="bodySmall" tone="muted">
          {msg}
        </AppText>
      ) : null}

      {showList && suggested.length > 0 && <AppText>Suggested (approve, edit or dismiss)</AppText>}
      {showList &&
        suggested.map((f) =>
          editing === f.id ? (
            <Editor key={f.id} f={f} onDone={() => setEditing(null)} />
          ) : (
            <View key={f.id} style={[styles.item, styles.itemRow]}>
              {line(f)}
              <TextButton title="Approve" onPress={() => void approve(f)} />
              <TextButton title="Edit" onPress={() => setEditing(f.id)} />
              <TextButton title="Dismiss" onPress={() => void dismissFollowup(f.id)} danger />
            </View>
          ),
        )}

      {showList && approved.length === 0 && suggested.length === 0 && (
        <AppText variant="bodySmall" tone="muted">
          No follow-ups yet.
        </AppText>
      )}
      {showList &&
        approved.map((f) =>
          editing === f.id ? (
            <Editor key={f.id} f={f} onDone={() => setEditing(null)} />
          ) : (
            <View key={f.id} style={[styles.item, styles.itemRow]}>
              {line(f)}
              <TextButton
                title="Done"
                onPress={() => void updateFollowup(f.id, { status: 'done' })}
              />
              {f.kind === 'event' && f.dueAt != null && (
                <TextButton title="Calendar" onPress={() => void toCalendar(f)} />
              )}
              <TextButton title="Edit" onPress={() => setEditing(f.id)} />
            </View>
          ),
        )}
      {showList &&
        done.map((f) => (
          <View key={f.id} style={[styles.item, styles.itemRow]}>
            {line(f)}
            <TextButton title="Delete" onPress={() => void deleteFollowup(f.id)} danger />
          </View>
        ))}
    </Section>
  );
}

function Editor({ f, onDone }: { f: Followup; onDone: () => void }) {
  const [title, setTitle] = useState(f.title);
  const [kind, setKind] = useState(f.kind);
  const [when, setWhen] = useState(f.whenText);
  const parsed = when.trim() ? parseWhen(when, new Date()) : null;
  const unchanged = when === f.whenText;
  const preview = unchanged
    ? formatDue(f, new Date())
    : parsed
      ? formatDue({ dueAt: parsed.at, allDay: parsed.allDay }, new Date())
      : '';

  const save = async () => {
    if (!title.trim()) return;
    await updateFollowup(f.id, {
      title: title.trim(),
      kind,
      whenText: when.trim(),
      ...(unchanged ? {} : { dueAt: parsed?.at ?? null, allDay: parsed?.allDay ?? false }),
    });
    onDone();
  };

  return (
    <View style={styles.item}>
      <Segmented
        accessibilityLabel="Kind"
        options={KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
        value={kind}
        onChange={setKind}
      />
      <TextField value={title} onChangeText={setTitle} placeholder="What" />
      <TextField
        value={when}
        onChangeText={setWhen}
        placeholder='When, e.g. "next Tuesday at 3" (optional)'
      />
      <AppText variant="bodySmall" tone="muted">
        {when.trim() ? (preview ? `Due ${preview}` : "Couldn't read that time") : 'No time'}
      </AppText>
      <View style={styles.itemRow}>
        <TextButton title="Save" onPress={() => void save()} />
        <TextButton title="Cancel" onPress={onDone} />
      </View>
    </View>
  );
}

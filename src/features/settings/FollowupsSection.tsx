import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

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
import { Row, Section, styles } from './ui';

const KINDS: FollowupKind[] = ['todo', 'event', 'reminder'];

/** Suggested and approved to-dos, events and reminders; nothing happens until approved. */
export function FollowupsSection({ part = 'both' }: { part?: 'settings' | 'list' | 'both' }) {
  const showSettings = part !== 'list';
  const showList = part !== 'settings';
  const [items, setItems] = useState<Followup[]>([]);
  const [suggest, setSuggest] = useState(getSettings().suggestFollowups);
  const [digest, setDigest] = useState(getSettings().followupDigest);
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

  const setDigestOn = async (v: boolean) => {
    if (v && !(await askNotificationPermission())) {
      setMsg('Allow notifications for Sidekick to get the daily summary.');
      return;
    }
    setDigest(v);
    updateSettings({ followupDigest: v });
  };

  const suggested = items.filter((f) => f.status === 'suggested');
  const approved = items.filter((f) => f.status === 'approved');
  const done = items.filter((f) => f.status === 'done');
  const now = new Date();

  const line = (f: Followup) => {
    const due = formatDue(f, now);
    return (
      <Text style={[styles.body, styles.flex, f.status === 'done' && styles.small]}>
        {`${kindLabel(f.kind)}: ${f.personName ? `${f.personName} — ` : ''}${f.title}${due ? ` · ${due}` : f.whenText ? ` · "${f.whenText}"` : ''}`}
      </Text>
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
        <Row
          label="Daily summary"
          hint={`A notification at ${getSettings().digestHour}:00 with today's follow-ups and anything still open from yesterday.`}
          value={digest}
          onChange={(v) => void setDigestOn(v)}
        />
      )}
      {showSettings && !exact && (
        <Pressable
          onPress={() =>
            void allowExactReminders()
              .then(setExact)
              .catch(() => {})
          }
        >
          <Text style={styles.link}>Allow exact reminder times (otherwise they may be late)</Text>
        </Pressable>
      )}
      {msg ? <Text style={styles.hint}>{msg}</Text> : null}

      {showList && suggested.length > 0 && (
        <Text style={styles.body}>Suggested (approve, edit or dismiss)</Text>
      )}
      {showList &&
        suggested.map((f) =>
          editing === f.id ? (
            <Editor key={f.id} f={f} onDone={() => setEditing(null)} />
          ) : (
            <View key={f.id} style={[styles.item, styles.itemRow]}>
              {line(f)}
              <Pressable onPress={() => void approve(f)}>
                <Text style={styles.link}>Approve</Text>
              </Pressable>
              <Pressable onPress={() => setEditing(f.id)}>
                <Text style={styles.link}>Edit</Text>
              </Pressable>
              <Pressable onPress={() => void dismissFollowup(f.id)}>
                <Text style={[styles.link, styles.danger]}>Dismiss</Text>
              </Pressable>
            </View>
          ),
        )}

      {showList && approved.length === 0 && suggested.length === 0 && (
        <Text style={styles.hint}>No follow-ups yet.</Text>
      )}
      {showList &&
        approved.map((f) =>
          editing === f.id ? (
            <Editor key={f.id} f={f} onDone={() => setEditing(null)} />
          ) : (
            <View key={f.id} style={[styles.item, styles.itemRow]}>
              {line(f)}
              <Pressable onPress={() => void updateFollowup(f.id, { status: 'done' })}>
                <Text style={styles.link}>Done</Text>
              </Pressable>
              {f.kind === 'event' && f.dueAt != null && (
                <Pressable onPress={() => void toCalendar(f)}>
                  <Text style={styles.link}>Calendar</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setEditing(f.id)}>
                <Text style={styles.link}>Edit</Text>
              </Pressable>
            </View>
          ),
        )}
      {showList &&
        done.map((f) => (
          <View key={f.id} style={[styles.item, styles.itemRow]}>
            {line(f)}
            <Pressable onPress={() => void deleteFollowup(f.id)}>
              <Text style={[styles.link, styles.danger]}>Delete</Text>
            </Pressable>
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
      <View style={styles.chips}>
        {KINDS.map((k) => (
          <Pressable
            key={k}
            onPress={() => setKind(k)}
            style={[styles.chip, kind === k && styles.chipOn]}
            accessibilityRole="radio"
            accessibilityState={{ checked: kind === k }}
          >
            <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{kindLabel(k)}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="What" />
      <TextInput
        style={styles.input}
        value={when}
        onChangeText={setWhen}
        placeholder='When, e.g. "next Tuesday at 3" (optional)'
      />
      <Text style={styles.hint}>
        {when.trim() ? (preview ? `Due ${preview}` : "Couldn't read that time") : 'No time'}
      </Text>
      <View style={styles.itemRow}>
        <Pressable onPress={() => void save()}>
          <Text style={styles.link}>Save</Text>
        </Pressable>
        <Pressable onPress={onDone}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { askNotificationPermission } from '@/engine/followup-notify';
import { type Routine, MAX_ROUTINES, TEMPLATES, describeWhen } from '@/engine/routines-logic';
import {
  deleteRoutine,
  editRoutine,
  exactRoutinesAllowed,
  listRoutines,
  onRoutinesChange,
  openExactRoutineSettings,
  routineRequest,
  updateRoutine,
} from '@/engine/routines-store';
import { Page } from '@/features/settings/Page';
import { Button, Section, confirm, formatTime, styles } from '@/features/settings/ui';
import { AppText, ListRow, SwitchRow, TextButton, TextField } from '@/ui';

/** Settings › Assistant › Routines: what Sidekick does by itself, at a time or on a trigger. */
export default function RoutinesSettings() {
  const [items, setItems] = useState<Routine[]>(listRoutines);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [exact, setExact] = useState(exactRoutinesAllowed);

  useEffect(() => onRoutinesChange(setItems), []);

  const add = async (said: string) => {
    const r = routineRequest(said);
    if (!r) {
      setMsg(
        'Start with when: "Every day at 6pm …", "Every Monday at 8 …" or "Whenever Sam messages me, …".',
      );
      return;
    }
    setMsg(r.text);
    if (r.routineId) {
      setText('');
      if (!(await askNotificationPermission()))
        setMsg(`${r.text} Notifications are off for Sidekick, so results show only in the chat.`);
    }
  };

  const save = (id: string) => {
    const why = editRoutine(id, text);
    if (why) setMsg(why);
    else {
      setEditing(null);
      setText('');
      setMsg('');
    }
  };

  const unused = TEMPLATES.filter(
    (t) => !items.some((r) => r.said.toLowerCase() === t.said.toLowerCase()),
  );

  return (
    <Page title="Routines">
      <AppText variant="bodySmall" tone="muted">
        Routines run on this phone at a time you choose or when something happens. The answer shows
        in the chat and as a notification, and is spoken into headphones or the car (not during
        quiet hours). Messages a routine writes wait for you to tap Send. Set one up by saying or
        typing it in the chat, e.g. &quot;every evening at 6 give me a recap of my day&quot;.
      </AppText>
      {!exact ? (
        <TextButton
          title="Allow exact times (Alarms &amp; reminders); otherwise routines may run a few minutes
            late"
          onPress={() => {
            openExactRoutineSettings();
            setTimeout(() => setExact(exactRoutinesAllowed()), 3000);
          }}
        />
      ) : null}
      <Section title={`Your routines (${items.length} of ${MAX_ROUTINES})`}>
        {items.length === 0 ? (
          <AppText variant="bodySmall" tone="muted">
            None yet.
          </AppText>
        ) : null}
        {items.map((r) => (
          <View key={r.id} style={styles.item}>
            <SwitchRow
              title={r.action}
              supporting={`${describeWhen(r.when)}${r.paused ? ' · paused' : ''}${r.lastRunAt ? ` · last ran ${formatTime(r.lastRunAt)}` : ''}`}
              value={!r.paused}
              onChange={(on) => updateRoutine(r.id, { paused: !on })}
            />
            {editing === r.id ? (
              <View style={styles.item}>
                <TextField
                  value={text}
                  onChangeText={setText}
                  autoFocus
                  multiline
                  accessibilityLabel="Routine"
                />
                <View style={styles.row}>
                  <Button title="Save" onPress={() => save(r.id)} />
                  <Button title="Cancel" onPress={() => setEditing(null)} />
                </View>
              </View>
            ) : (
              <View style={styles.row}>
                <TextButton
                  title="Edit"
                  onPress={() => {
                    setEditing(r.id);
                    setText(r.said);
                  }}
                />
                <TextButton
                  title="Delete"
                  onPress={() =>
                    confirm('Delete this routine?', r.action, () => deleteRoutine(r.id))
                  }
                  danger
                />
              </View>
            )}
          </View>
        ))}
      </Section>
      <Section title="Add a routine">
        <TextField
          value={editing ? '' : text}
          onChangeText={setText}
          placeholder="Every weekday at 8am brief me"
          editable={!editing}
          accessibilityLabel="New routine"
        />
        <Button title="Add" onPress={() => void add(text)} />
        {msg ? (
          <AppText variant="bodySmall" tone="muted">
            {msg}
          </AppText>
        ) : null}
        {unused.length ? (
          <AppText variant="bodySmall" tone="muted">
            Suggestions (tap one to add it):
          </AppText>
        ) : null}
        {unused.map((t) => (
          <ListRow
            key={t.said}
            title={t.said}
            onPress={() => void add(t.said)}
            accessibilityHint="Adds this routine"
          />
        ))}
      </Section>
      <AppText variant="bodySmall" tone="muted">
        Limits: up to {MAX_ROUTINES} routines, at most every 15 minutes. Routines that need the AI
        model wait while battery saver is on or the battery is under 15% (unless charging), and run
        later marked late; a time missed by more than 12 hours is skipped. Charging, unlock and
        headphone triggers work while Sidekick is running (for example with Listen on). Message
        triggers need Notification access (Settings › Connections).
      </AppText>
    </Page>
  );
}

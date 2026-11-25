import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

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
      <Text style={styles.hint}>
        Routines run on this phone at a time you choose or when something happens. The answer shows
        in the chat and as a notification, and is spoken into headphones or the car (not during
        quiet hours). Messages a routine writes wait for you to tap Send. Set one up by saying or
        typing it in the chat, e.g. &quot;every evening at 6 give me a recap of my day&quot;.
      </Text>
      {!exact ? (
        <Pressable
          onPress={() => {
            openExactRoutineSettings();
            setTimeout(() => setExact(exactRoutinesAllowed()), 3000);
          }}
        >
          <Text style={styles.link}>
            Allow exact times (Alarms &amp; reminders); otherwise routines may run a few minutes
            late
          </Text>
        </Pressable>
      ) : null}
      <Section title={`Your routines (${items.length} of ${MAX_ROUTINES})`}>
        {items.length === 0 ? <Text style={styles.hint}>None yet.</Text> : null}
        {items.map((r) => (
          <View key={r.id} style={styles.item}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={[styles.body, r.paused && styles.small]}>{r.action}</Text>
                <Text style={styles.small}>
                  {describeWhen(r.when)}
                  {r.paused ? ' · paused' : ''}
                  {r.lastRunAt ? ` · last ran ${formatTime(r.lastRunAt)}` : ''}
                </Text>
              </View>
              <Switch
                value={!r.paused}
                onValueChange={(on) => updateRoutine(r.id, { paused: !on })}
                accessibilityLabel={r.paused ? 'Resume' : 'Pause'}
              />
            </View>
            {editing === r.id ? (
              <View style={{ gap: 8 }}>
                <TextInput
                  style={styles.input}
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
                <Pressable
                  onPress={() => {
                    setEditing(r.id);
                    setText(r.said);
                  }}
                >
                  <Text style={styles.link}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    confirm('Delete this routine?', r.action, () => deleteRoutine(r.id))
                  }
                >
                  <Text style={[styles.link, styles.danger]}>Delete</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
      </Section>
      <Section title="Add a routine">
        <TextInput
          style={styles.input}
          value={editing ? '' : text}
          onChangeText={setText}
          placeholder="Every weekday at 8am brief me"
          editable={!editing}
          accessibilityLabel="New routine"
        />
        <Button title="Add" onPress={() => void add(text)} />
        {msg ? <Text style={styles.hint}>{msg}</Text> : null}
        {unused.length ? <Text style={styles.small}>Suggestions (tap to add):</Text> : null}
        <View style={styles.chips}>
          {unused.map((t) => (
            <Pressable key={t.said} style={styles.chip} onPress={() => void add(t.said)}>
              <Text>{t.said}</Text>
            </Pressable>
          ))}
        </View>
      </Section>
      <Text style={styles.hint}>
        Limits: up to {MAX_ROUTINES} routines, at most every 15 minutes. Routines that need the AI
        model wait while battery saver is on or the battery is under 15% (unless charging), and run
        later marked late; a time missed by more than 12 hours is skipped. Charging, unlock and
        headphone triggers work while Sidekick is running (for example with Listen on). Message
        triggers need Notification access (Settings › Connections).
      </Text>
    </Page>
  );
}

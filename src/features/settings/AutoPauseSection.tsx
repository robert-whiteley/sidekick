import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { formatMinutes, parseTime } from '@/engine/place-logic';
import { addPausePlaceHere, pushPauseRules, removePausePlace } from '@/engine/places';
import { getSettings, type Settings, updateSettings } from '@/engine/settings';
import { Button, Row, Section, styles } from './ui';

/** Quiet hours and "pause here" places. Push-to-talk always works. */
export function AutoPauseSection() {
  const [s, setS] = useState<Settings>(getSettings());
  const [start, setStart] = useState(formatMinutes(s.quietStart));
  const [end, setEnd] = useState(formatMinutes(s.quietEnd));
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');

  const set = (patch: Partial<Settings>) => {
    setS(updateSettings(patch));
    pushPauseRules();
  };

  const saveTimes = () => {
    const a = parseTime(start);
    const b = parseTime(end);
    if (a === null || b === null) {
      setMsg('Use times like 22:00 and 07:00.');
      return;
    }
    setMsg('');
    setStart(formatMinutes(a));
    setEnd(formatMinutes(b));
    set({ quietStart: a, quietEnd: b });
  };

  const pauseHere = () => {
    const p = addPausePlaceHere(name);
    if (!p) {
      setMsg('Location unknown. Allow location for Sidekick, start listening, then try again.');
      return;
    }
    setMsg('');
    setName('');
    setS(getSettings());
  };

  return (
    <Section title="Auto-pause">
      <Text style={styles.hint}>
        While paused, Sidekick does not listen for the wake word or keep anything. Holding the mic
        button still works. Silence is never processed anyway.
      </Text>
      <Row
        label="Quiet hours"
        hint={`Pause every day from ${formatMinutes(s.quietStart)} to ${formatMinutes(s.quietEnd)}.`}
        value={s.quietHours}
        onChange={(v) => set({ quietHours: v })}
      />
      {s.quietHours && (
        <View style={styles.itemRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={start}
            onChangeText={setStart}
            onEndEditing={saveTimes}
            placeholder="22:00"
            accessibilityLabel="Quiet hours start"
          />
          <Text style={styles.body}> to </Text>
          <TextInput
            style={[styles.input, styles.flex]}
            value={end}
            onChangeText={setEnd}
            onEndEditing={saveTimes}
            placeholder="07:00"
            accessibilityLabel="Quiet hours end"
          />
        </View>
      )}
      <Text style={styles.label}>Pause listening here</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Name, e.g. Work"
        autoCapitalize="words"
      />
      <Button title="Pause listening here" onPress={pauseHere} />
      {msg ? <Text style={styles.hint}>{msg}</Text> : null}
      {s.pausePlaces.map((p) => (
        <View key={p.id} style={styles.itemRow}>
          <Text style={[styles.body, styles.flex]}>
            {p.name} ({p.radiusM} m)
          </Text>
          <Pressable
            onPress={() => {
              removePausePlace(p.id);
              setS(getSettings());
            }}
            accessibilityLabel={`Delete ${p.name}`}
          >
            <Text style={[styles.link, styles.danger]}>Delete</Text>
          </Pressable>
        </View>
      ))}
    </Section>
  );
}

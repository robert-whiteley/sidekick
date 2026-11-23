import { useState } from 'react';
import { Text, TextInput } from 'react-native';

import { configureListening, wakeLine } from '@/engine/listen';
import { getSettings, type Settings, updateSettings } from '@/engine/settings';
import { Button, Row, Section, styles } from './ui';

export function ListeningSection() {
  const [s, setS] = useState<Settings>(getSettings());
  const [phrase, setPhrase] = useState(s.wakePhrase);
  const [msg, setMsg] = useState('');

  const set = (patch: Partial<Settings>) => {
    setS(updateSettings(patch));
    configureListening();
  };

  const saveWake = () => {
    const p = phrase.trim();
    if (!p) return;
    const r = wakeLine(p);
    if (r.phrase.toLowerCase() !== p.toLowerCase()) {
      setMsg(
        `"${p}" can't be used as a wake word (unsupported letters). Keeping "${s.wakePhrase}".`,
      );
      setPhrase(s.wakePhrase);
      return;
    }
    set({ wakePhrase: p });
    setMsg(`Wake word set to "${p}".`);
  };

  return (
    <>
      <Section title="Listening">
        <Text style={styles.body}>Wake word</Text>
        <TextInput
          style={styles.input}
          value={phrase}
          onChangeText={setPhrase}
          onSubmitEditing={saveWake}
          placeholder="Hey Sidekick"
          autoCapitalize="words"
        />
        <Button title="Save wake word" onPress={saveWake} />
        {msg ? <Text style={styles.hint}>{msg}</Text> : null}
        <Row
          label="Remember conversations"
          hint="Keep transcripts of what is said around you while listening, not just your questions."
          value={s.recordConversations}
          onChange={(v) => set({ recordConversations: v })}
        />
        <Row
          label="Consent mode"
          hint={
            'Other people\'s speech is only kept after they agree — e.g. you ask "is it OK if I take notes?" and they say yes.'
          }
          value={s.consentMode}
          onChange={(v) => set({ consentMode: v })}
        />
        <Row
          label="Speak answers"
          value={s.speakAnswers}
          onChange={(v) => set({ speakAnswers: v })}
        />
        <Row
          label="Remember photos"
          hint="Keep photos you ask about, so later questions can look at them again."
          value={s.rememberPhotos}
          onChange={(v) => set({ rememberPhotos: v })}
        />
      </Section>
    </>
  );
}

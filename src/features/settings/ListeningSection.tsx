import { useState } from 'react';
import { Platform } from 'react-native';

import { configureListening, wakeLine } from '@/engine/listen';
import { currentRegion } from '@/engine/region';
import { getSettings, type Settings, updateSettings } from '@/engine/settings';
import { type ConsentChoice, lawRequiresConsent } from '@/memory/consent-region';
import { Button, Row, Section } from './ui';
import { AppText, PickerRow, TextField } from '@/ui';

const CONSENT_OPTIONS: { value: ConsentChoice; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

function consentHint(choice: ConsentChoice): string {
  const how =
    'Other people\'s speech is only kept after they agree, e.g. you ask "is it OK if I take notes?" and they say yes.';
  if (choice !== 'auto') return how;
  const r = currentRegion();
  const where = r.country
    ? r.admin1 && r.country === 'US'
      ? `${r.admin1}, US`
      : r.country
    : 'unknown';
  const on = lawRequiresConsent(r);
  return `${how} Automatic follows the recording law where you are (${where}): ${on ? 'on' : 'off'} here. Not legal advice.`;
}

/**
 * part: 'assistant' = wake word and spoken answers; 'listening' = what is kept while listening;
 * 'privacy' = consent and instructions-only; 'all' = everything (one page).
 */
export function ListeningSection({
  part = 'all',
}: {
  part?: 'assistant' | 'listening' | 'privacy' | 'all';
}) {
  const show = (p: typeof part) => part === 'all' || part === p;
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

  const title =
    part === 'assistant' ? 'Talking to Sidekick' : part === 'privacy' ? 'Recording' : 'Listening';

  return (
    <Section title={title}>
      {show('assistant') && (
        <>
          {/* iPhone: no wake word (no background listening, ADR 0006); hold the mic instead. */}
          {Platform.OS !== 'ios' && (
            <>
              <TextField
                label="Wake word"
                value={phrase}
                onChangeText={setPhrase}
                onSubmitEditing={saveWake}
                placeholder="Hey Sidekick"
                autoCapitalize="words"
              />
              <Button title="Save wake word" onPress={saveWake} />
              {msg ? (
                <AppText variant="bodySmall" tone="muted">
                  {msg}
                </AppText>
              ) : null}
            </>
          )}
          <Row
            label="Speak answers"
            value={s.speakAnswers}
            onChange={(v) => set({ speakAnswers: v })}
          />
        </>
      )}
      {show('listening') && (
        <>
          <Row
            label="Remember conversations"
            hint="Keep transcripts of what is said around you while listening, not just your questions."
            value={s.recordConversations}
            onChange={(v) => set({ recordConversations: v })}
          />
          <Row
            label="Show conversation"
            hint="Show what is said, and who said it, on the main screen while listening. Off only hides it; it doesn't change what is kept."
            value={s.showConversation}
            onChange={(v) => setS(updateSettings({ showConversation: v }))}
          />
          <Row
            label="Remember photos"
            hint="Keep photos you ask about, so later questions can look at them again."
            value={s.rememberPhotos}
            onChange={(v) => set({ rememberPhotos: v })}
          />
        </>
      )}
      {show('privacy') && (
        <>
          <Row
            label="Instructions only"
            hint='For when you are with other people: nothing around you is transcribed or kept. Only "Sidekick …" / "Hey Sidekick …" and holding the mic are taken.'
            value={s.instructionsOnly}
            onChange={(v) => set({ instructionsOnly: v })}
          />
          <PickerRow
            label="Consent mode"
            hint={consentHint(s.consent)}
            options={CONSENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={s.consent}
            onChange={(v) => set({ consent: v })}
          />
        </>
      )}
    </Section>
  );
}

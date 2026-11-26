import { useEffect, useState } from 'react';

import { pushAssistantPrompt } from '@/engine/listen';
import { ANSWER_STYLE_MAX } from '@/engine/prompts';
import { getSettings, updateSettings } from '@/engine/settings';
import { AppText, TextField } from '@/ui';
import { Section } from './ui';

/**
 * "How Sidekick answers": a short note of the user's own (e.g. "keep answers short, call me Rob,
 * metric units"), added to the chat's instructions. Stays on the phone; in the export.
 */
export function AnswerStyleSection() {
  const [text, setText] = useState(getSettings().answerStyle);
  // Saved a moment after typing stops: each change restarts the model's chat.
  useEffect(() => {
    if (text === getSettings().answerStyle) return;
    const t = setTimeout(() => {
      updateSettings({ answerStyle: text.trim() });
      pushAssistantPrompt();
    }, 800);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <Section title="How Sidekick answers">
      <TextField
        value={text}
        onChangeText={setText}
        placeholder="e.g. keep answers short, call me Rob, metric units"
        accessibilityLabel="How Sidekick answers"
        maxLength={ANSWER_STYLE_MAX}
        multiline
      />
      <AppText variant="bodySmall" tone="muted">
        {`Sidekick follows this in every answer. It stays on this phone. ${text.length}/${ANSWER_STYLE_MAX}`}
      </AppText>
    </Section>
  );
}

import { ChoiceRow, Section } from './ui';
import { useSettings } from './useSettings';

/** Settings → Assistant: live conversation notes. Recaps are asked for, over any time. */
export function NotesRecapSection() {
  const { s, set } = useSettings();
  return (
    <Section title="Notes and recaps">
      <ChoiceRow<'auto' | 'off'>
        label="Conversation notes"
        hint="While you talk with someone with Listen on, live notes of who is there, topics, decisions and action items, updated as it goes (action items are offered as follow-ups). Not while off the record. Recaps of any time are asked for: “recap the last 2 hours”, “what did we talk about on Tuesday”, “recap what we've been working on”."
        options={[
          { value: 'auto', label: 'Automatic' },
          { value: 'off', label: 'Off' },
        ]}
        value={s.conversationNotes}
        recommended="auto"
        onChange={(v) => set({ conversationNotes: v })}
      />
    </Section>
  );
}

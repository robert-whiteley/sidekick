import { RECAP_TIMES } from '@/memory/day-recap-logic';
import { ChoiceRow, Section } from './ui';
import { useSettings } from './useSettings';

/** Settings → Assistant: automatic conversation notes and the evening "Your day" recap. */
export function NotesRecapSection() {
  const { s, set } = useSettings();
  return (
    <Section title="Notes and recap">
      <ChoiceRow<'auto' | 'off'>
        label="Conversation notes"
        hint="When a conversation heard with Listen on ends, a short note of who was there, topics, decisions and action items (offered as follow-ups). Not while off the record."
        options={[
          { value: 'auto', label: 'Automatic' },
          { value: 'off', label: 'Off' },
        ]}
        value={s.conversationNotes}
        recommended="auto"
        onChange={(v) => set({ conversationNotes: v })}
      />
      <ChoiceRow<string>
        label="Your day"
        hint="An evening line in the chat: the day's conversations, places, things seen and to-dos. Tap it for the full recap."
        options={[
          { value: 'off', label: 'Off' },
          ...RECAP_TIMES.map((t) => ({ value: t, label: t })),
        ]}
        value={s.dayRecap}
        recommended="off"
        onChange={(v) => set({ dayRecap: v })}
      />
    </Section>
  );
}

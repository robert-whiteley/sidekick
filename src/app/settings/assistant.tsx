import { EntryPointsSection } from '@/features/settings/EntryPointsSection';
import { FollowupsSection } from '@/features/settings/FollowupsSection';
import { NotesRecapSection } from '@/features/settings/NotesRecapSection';
import { ListeningSection } from '@/features/settings/ListeningSection';
import { phoneLocale } from '@/engine/language';
import { languageName, languagePlan } from '@/engine/language-logic';
import { Page } from '@/features/settings/Page';
import { ChoiceRow, NavRow, Section } from '@/features/settings/ui';
import { useSettings } from '@/features/settings/useSettings';
import type { HandsFreeMode } from '@/engine/hands-free-logic';
import { formatMinutes } from '@/engine/place-logic';
import type { ReadBackMode } from '@/engine/readback-logic';
import type { SmartDefault } from '@/engine/settings';
import { NOTE_TEMPLATES, type NoteTemplateId } from '@/memory/note-templates';

/** "Automatic (German)" / "Deutsch". */
function languageHint(choice: string): string {
  const plan = languagePlan(choice ?? 'auto', phoneLocale());
  const name = languageName(plan.answer);
  return choice === 'auto' || !choice ? `Automatic (${name})` : name;
}

const MODEL_TIER_LABEL = { small: 'Small and fast', standard: 'Standard', large: 'Large' };

export default function AssistantSettings() {
  const { s, rec, set } = useSettings();
  return (
    <Page title="Assistant">
      <Section title="Language">
        <NavRow label="Language" hint={languageHint(s.speechLanguage)} href="/settings/language" />
      </Section>
      <Section title="Voice">
        <ChoiceRow
          label="Voice for answers"
          hint="One voice is used all the time; it never switches mid-answer."
          options={[
            { value: 'pocket', label: 'Natural voice' },
            { value: 'system', label: "Phone's voice" },
          ]}
          value={s.voiceChoice === 'auto' ? null : s.voiceChoice}
          recommended={rec.voice}
          onChange={(v) => set({ voiceChoice: v ?? 'auto' })}
        />
        <ChoiceRow<number>
          label="Speech speed"
          hint={'Also by voice: "speak slower", "speak faster", "normal speed".'}
          options={[
            { value: 0.75, label: '75%' },
            { value: 0.9, label: '90%' },
            { value: 1, label: 'Normal' },
            { value: 1.15, label: '115%' },
            { value: 1.3, label: '130%' },
            { value: 1.5, label: '150%' },
          ]}
          value={s.speechRate}
          recommended={1}
          onChange={(v) => set({ speechRate: v === 1 ? null : v })}
        />
      </Section>
      <Section title="Hands-free">
        <ChoiceRow<ReadBackMode>
          label="Read back before sending"
          hint={
            'Says what it is about to send ("Text to Sam: running late. Send it?") and listens for yes, no, "change it to …" or "add …". The countdown starts after.'
          }
          options={[
            { value: 'voice', label: 'When I speak' },
            { value: 'always', label: 'Always' },
            { value: 'off', label: 'Off' },
          ]}
          value={s.readBack}
          recommended="voice"
          onChange={(v) => set({ readBack: v })}
        />
        <ChoiceRow<HandsFreeMode>
          label="Driving and walking mode"
          hint="Spoken answers, read-back and bigger buttons. Automatic: when the car's Bluetooth connects or you ask with the headset button."
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'on', label: 'Always on' },
            { value: 'off', label: 'Off' },
          ]}
          value={s.handsFree}
          recommended="auto"
          onChange={(v) => set({ handsFree: v })}
        />
        <ChoiceRow<'on' | 'off'>
          label="Quiet at night"
          hint={`No speaking out loud from ${formatMinutes(s.quietStart)} to ${formatMinutes(s.quietEnd)} or in Do Not Disturb. Headphones and the car still get answers. Times: Privacy › Auto-pause.`}
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          value={s.quietSpeech == null ? null : s.quietSpeech ? 'on' : 'off'}
          recommended="on"
          onChange={(v) => set({ quietSpeech: v == null ? null : v === 'on' })}
        />
        <ChoiceRow<'on' | 'off'>
          label="Vibrate on send and listen"
          hint="A light tick when something is sent or cancelled and when Sidekick starts listening."
          options={[
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
          value={s.haptics == null ? null : s.haptics ? 'on' : 'off'}
          recommended="on"
          onChange={(v) => set({ haptics: v == null ? null : v === 'on' })}
        />
      </Section>
      <Section title="Model">
        <NavRow
          label="AI model"
          hint={`Recommended for this phone: ${MODEL_TIER_LABEL[rec.modelTier]}`}
          href="/settings/models"
        />
        <ChoiceRow<SmartDefault>
          label="Better models"
          hint="Automatic: downloads on Wi-Fi while charging, switches once it works and deletes the old one."
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'ask', label: 'Ask me first' },
            { value: 'off', label: 'Off' },
          ]}
          value={s.modelUpdates === 'auto' ? null : s.modelUpdates}
          recommended="auto"
          onChange={(v) => set({ modelUpdates: v ?? 'auto' })}
        />
      </Section>
      <ListeningSection part="assistant" />
      <FollowupsSection part="settings" />
      <NotesRecapSection />
      <Section title="Note style">
        <ChoiceRow<NoteTemplateId | 'general'>
          label="Notes shaped for"
          hint={
            'Extra sections for one kind of conversation, e.g. a doctor\'s appointment: symptoms, medicines, next steps. Or say it at the time: "this is a meeting", "this is a lecture".'
          }
          options={[
            { value: 'general', label: 'Any conversation' },
            ...Object.values(NOTE_TEMPLATES).map((t) => ({ value: t.id, label: t.label })),
          ]}
          value={s.defaultNoteTemplate}
          recommended="general"
          onChange={(v) => set({ defaultNoteTemplate: v === 'general' ? null : v })}
        />
      </Section>
      <EntryPointsSection />
    </Page>
  );
}

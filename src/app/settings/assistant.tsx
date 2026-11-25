import { EntryPointsSection } from '@/features/settings/EntryPointsSection';
import { FollowupsSection } from '@/features/settings/FollowupsSection';
import { NotesRecapSection } from '@/features/settings/NotesRecapSection';
import { ListeningSection } from '@/features/settings/ListeningSection';
import { Page } from '@/features/settings/Page';
import { ChoiceRow, NavRow, Section } from '@/features/settings/ui';
import { useSettings } from '@/features/settings/useSettings';
import type { HandsFreeMode } from '@/engine/hands-free-logic';
import { formatMinutes } from '@/engine/place-logic';
import type { ReadBackMode } from '@/engine/readback-logic';
import type { SmartDefault } from '@/engine/settings';

const MODEL_TIER_LABEL = { small: 'Small and fast', standard: 'Standard', large: 'Large' };

export default function AssistantSettings() {
  const { s, rec, set } = useSettings();
  return (
    <Page title="Assistant">
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
      <EntryPointsSection />
    </Page>
  );
}

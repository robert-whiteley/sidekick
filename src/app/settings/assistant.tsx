import { EntryPointsSection } from '@/features/settings/EntryPointsSection';
import { FollowupsSection } from '@/features/settings/FollowupsSection';
import { NotesRecapSection } from '@/features/settings/NotesRecapSection';
import { ListeningSection } from '@/features/settings/ListeningSection';
import { applySpeechModel } from '@/engine/language';
import { Page } from '@/features/settings/Page';
import { ChoiceRow, NavRow, Row, Section } from '@/features/settings/ui';
import { useSettings } from '@/features/settings/useSettings';
import type { HandsFreeMode } from '@/engine/hands-free-logic';
import { formatMinutes } from '@/engine/place-logic';
import type { ReadBackMode } from '@/engine/readback-logic';
import type { SmartDefault } from '@/engine/settings';
import { MAX_RATE, MIN_RATE } from '@/engine/quick-commands-logic';
import { SliderRow } from '@/ui';

const MODEL_TIER_LABEL = { small: 'Small and fast', standard: 'Standard', large: 'Large' };

export default function AssistantSettings() {
  const { s, rec, set } = useSettings();
  return (
    <Page title="Assistant">
      <Section title="Languages">
        <Row
          label="Understand other languages around me"
          hint={
            'Sidekick speaks English. With this on, it also hears 24 other European languages ' +
            'around you (French, German, Spanish, Polish, Ukrainian…) and shows an English ' +
            'translation under each line, so you can ask "what did the waiter say?". English ' +
            'is understood a little less well in quiet (2.9% → 3.8% words wrong) and much less ' +
            'well in noise (7.2% → 17.9%). Needs a 0.5 GB download on Wi-Fi.'
          }
          value={s.understandOtherLanguages}
          onChange={(v) => {
            set({ understandOtherLanguages: v });
            applySpeechModel();
          }}
        />
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
        <SliderRow
          label="Speech speed"
          hint={'Also by voice: "speak slower", "speak faster", "normal speed".'}
          min={MIN_RATE}
          max={MAX_RATE}
          step={0.05}
          value={s.speechRate}
          recommended={1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set({ speechRate: v === null || v === 1 ? null : v })}
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

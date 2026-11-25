import { EntryPointsSection } from '@/features/settings/EntryPointsSection';
import { FollowupsSection } from '@/features/settings/FollowupsSection';
import { ListeningSection } from '@/features/settings/ListeningSection';
import { Page } from '@/features/settings/Page';
import { ChoiceRow, NavRow, Section } from '@/features/settings/ui';
import { useSettings } from '@/features/settings/useSettings';
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
      <EntryPointsSection />
    </Page>
  );
}

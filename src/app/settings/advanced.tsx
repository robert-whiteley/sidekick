import { RESERVE_OPTIONS } from '@/engine/device-profile';
import { onIphone, platformText } from '@/engine/platform-text';
import { DEFAULTS } from '@/engine/settings';
import { ChipSection } from '@/features/settings/ChipSection';
import { Page } from '@/features/settings/Page';
import { Button, ChoiceRow, NavRow, Row, Section } from '@/features/settings/ui';
import { useSettings } from '@/features/settings/useSettings';
import { AppText } from '@/ui';

export default function AdvancedSettings() {
  const { s, rec, set } = useSettings();
  return (
    <Page title="Advanced">
      <Section title="Storage">
        <ChoiceRow
          label="Always keep free for the phone"
          options={RESERVE_OPTIONS.map((g) => ({ value: g, label: `${g} GB` }))}
          value={s.storageReserveGB}
          recommended={rec.storageReserveGB}
          format={(g) => `${g} GB`}
          onChange={(v) => set({ storageReserveGB: v })}
        />
        <NavRow label="Storage" hint="What uses space, keep periods, clean up" href="/storage" />
      </Section>
      <Section title="Downloads">
        <ChoiceRow<'ask' | 'auto' | 'off'>
          label="Large downloads on mobile data"
          options={[
            { value: 'ask', label: 'Ask me' },
            { value: 'auto', label: 'Allow' },
            { value: 'off', label: 'Wi-Fi only' },
          ]}
          value={
            s.mobileDataDownloads === DEFAULTS.mobileDataDownloads ? null : s.mobileDataDownloads
          }
          recommended={DEFAULTS.mobileDataDownloads}
          onChange={(v) => set({ mobileDataDownloads: v ?? DEFAULTS.mobileDataDownloads })}
        />
        <Row
          label="Get quick fixes (Recommended)"
          hint={platformText('quickFixesHint')}
          value={s.quickFixes}
          onChange={(v) => set({ quickFixes: v })}
        />
      </Section>
      {/* iPhone: the model runs on the CPU only (ADR 0006), so there is no chip to choose. */}
      {onIphone() ? null : <ChipSection />}
      <Section title="Reset">
        <AppText variant="bodySmall" tone="muted">
          Sets every adjustable setting back to Recommended for this phone.
        </AppText>
        <Button
          title="Use all Recommended values"
          onPress={() =>
            set({
              voiceChoice: DEFAULTS.voiceChoice,
              fps: null,
              frameWindow: null,
              imageDetail: null,
              videoKeepHours: null,
              audioKeepDays: null,
              storageReserveGB: null,
              modelUpdates: DEFAULTS.modelUpdates,
              mobileDataDownloads: DEFAULTS.mobileDataDownloads,
              quickFixes: DEFAULTS.quickFixes,
            })
          }
        />
      </Section>
      <NavRow label="Speed test (developer)" href="/bench" />
    </Page>
  );
}

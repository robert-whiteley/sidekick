import { Link } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { RESERVE_OPTIONS } from '@/engine/device-profile';
import { DEFAULTS } from '@/engine/settings';
import { ChipSection } from '@/features/settings/ChipSection';
import { Page } from '@/features/settings/Page';
import { ACCENT, Button, ChoiceRow, NavRow, Section, styles } from '@/features/settings/ui';
import { useSettings } from '@/features/settings/useSettings';

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
      </Section>
      <ChipSection />
      <Section title="Reset">
        <Text style={styles.hint}>
          Sets every adjustable setting back to Recommended for this phone.
        </Text>
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
            })
          }
        />
      </Section>
      <Link href="/bench" style={local.link}>
        Speed test (developer)
      </Link>
    </Page>
  );
}

const local = StyleSheet.create({ link: { fontSize: 16, color: ACCENT, marginTop: 12 } });

import { Text } from 'react-native';

import {
  AUDIO_KEEP_OPTIONS,
  FPS_OPTIONS,
  FRAME_WINDOW_OPTIONS,
  VIDEO_KEEP_OPTIONS,
} from '@/engine/device-profile';
import type { ImageDetail } from '@/engine/settings';
import { daysLabel, hoursLabel } from '@/features/settings/choice-logic';
import { DevicesSection } from '@/features/settings/DevicesSection';
import { ListeningSection } from '@/features/settings/ListeningSection';
import { Page } from '@/features/settings/Page';
import { ChoiceRow, Section, styles } from '@/features/settings/ui';
import { useSettings } from '@/features/settings/useSettings';

export default function CameraAudioSettings() {
  const { s, rec, set } = useSettings();
  return (
    <Page title="Camera & audio">
      <DevicesSection />
      <Section title="Camera memory">
        <ChoiceRow
          label="Frames per second"
          hint="More frames catch more, but use more battery and warm the phone. Lowered by itself when hot, with a note."
          options={FPS_OPTIONS.map((v) => ({ value: v, label: `${v}` }))}
          value={s.fps}
          recommended={rec.fps}
          onChange={(v) => set({ fps: v })}
        />
        <ChoiceRow
          label="Frames per question"
          hint="How many recent frames Sidekick looks at, to see movement and change. More is slower."
          options={FRAME_WINDOW_OPTIONS.map((v) => ({ value: v, label: `${v}` }))}
          value={s.frameWindow}
          recommended={rec.frameWindow}
          onChange={(v) => set({ frameWindow: v })}
        />
        <ChoiceRow<ImageDetail>
          label="Image detail"
          hint="Higher reads small text better but answers more slowly."
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
          value={s.imageDetail}
          recommended={rec.imageDetail}
          onChange={(v) => set({ imageDetail: v })}
        />
      </Section>
      <Section title="Keep">
        <ChoiceRow
          label="Video"
          hint="Rolling video (about 0.5 GB per hour of recording). Stills, text and search stay longer."
          options={VIDEO_KEEP_OPTIONS.map((h) => ({ value: h, label: hoursLabel(h) }))}
          value={s.videoKeepHours}
          recommended={rec.videoKeepHours}
          onChange={(v) => set({ videoKeepHours: v })}
        />
        <ChoiceRow
          label="Conversation audio"
          hint="For listening back from search results (about 7 MB per hour of speech)."
          options={AUDIO_KEEP_OPTIONS.map((d) => ({ value: d, label: daysLabel(d) }))}
          value={s.audioKeepDays}
          recommended={rec.audioKeepDays}
          onChange={(v) => set({ audioKeepDays: v })}
        />
        <Text style={styles.hint}>
          Recommended values are worked out from this phone and its free space.
        </Text>
      </Section>
      <ListeningSection part="listening" />
    </Page>
  );
}

import { captionMode } from '@/memory/photo-text';
import {
  AUDIO_KEEP_OPTIONS,
  FPS_OPTIONS,
  FRAME_WINDOW_OPTIONS,
  VIDEO_KEEP_OPTIONS,
} from '@/engine/device-profile';
import { IPHONE, onIphone } from '@/engine/platform-text';
import type { ImageDetail } from '@/engine/settings';
import { daysLabel, hoursLabel } from '@/features/settings/choice-logic';
import { DevicesSection } from '@/features/settings/DevicesSection';
import { ListeningSection } from '@/features/settings/ListeningSection';
import { Page } from '@/features/settings/Page';
import { ChoiceRow, Row, Section } from '@/features/settings/ui';
import { useSettings } from '@/features/settings/useSettings';
import { AppText } from '@/ui';

export default function CameraAudioSettings() {
  const { s, rec, set } = useSettings();
  if (onIphone())
    return (
      <Page title="Camera & audio">
        <Section title="Camera memory">
          <AppText>{IPHONE.liveCameraSettings}</AppText>
        </Section>
        <ListeningSection part="listening" />
      </Page>
    );
  return (
    <Page title="Camera & audio">
      <DevicesSection />
      <Section title="Camera memory">
        <ChoiceRow<'back' | 'front'>
          label="Phone camera"
          hint='Which side of the phone films. Also by voice: "use the front camera".'
          options={[
            { value: 'back', label: 'Back' },
            { value: 'front', label: 'Front' },
          ]}
          value={s.cameraLens === 'front' ? 'front' : null}
          recommended="back"
          onChange={(v) => set({ cameraLens: v ?? 'back' })}
        />
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
        <Row
          label="Keep filming when the phone is locked"
          hint="Recommended: on, so Sidekick still remembers with the screen off (phone or USB camera). Off pauses the camera until you unlock. Pause or stop it any time from the notification."
          value={s.cameraWhileLocked !== false}
          onChange={(v) => set({ cameraWhileLocked: v })}
        />
        <ChoiceRow
          label="Describe camera frames"
          hint="When you are not using Sidekick, it writes what each camera frame shows (things, how many, text, movement), so later questions like “how many people were at the bus stop?” work. Stays on the phone and stops when you ask something. Also covers making photos searchable by meaning. On battery too uses more battery and stops below 30%; all of it pauses when the phone is hot."
          options={[
            { value: 'off', label: 'Off' },
            { value: 'charging', label: 'While charging' },
            { value: 'always', label: 'On battery too' },
          ]}
          value={captionMode(s.captionFrames)}
          recommended="charging"
          onChange={(v) => set({ captionFrames: v ?? 'charging' })}
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
        <AppText variant="bodySmall" tone="muted">
          Recommended values are worked out from this phone and its free space.
        </AppText>
      </Section>
      <ListeningSection part="listening" />
    </Page>
  );
}

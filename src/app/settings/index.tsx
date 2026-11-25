import { Page } from '@/features/settings/Page';
import { NavRow } from '@/features/settings/ui';

export default function SettingsScreen() {
  return (
    <Page title="Settings">
      <NavRow
        label="Assistant"
        hint="Voice, model, wake word, follow-ups"
        href="/settings/assistant"
      />
      <NavRow
        label="Camera & audio"
        hint="Inputs and outputs, frame rate, how long video is kept"
        href="/settings/camera"
      />
      <NavRow
        label="Connections"
        hint="Calendar, messages, email and other apps"
        href="/settings/connections"
      />
      <NavRow
        label="Privacy"
        hint="Recording consent, pause places, online lookup, export, delete"
        href="/settings/privacy"
      />
      <NavRow
        label="Phone features"
        hint="What this phone can and can't do"
        href="/settings/features"
      />
      <NavRow
        label="Advanced"
        hint="Storage reserve, downloads, AI chip"
        href="/settings/advanced"
      />
      <NavRow label="Memory" hint="You, people, to-dos, timeline, saved" href="/memory" />
      <NavRow label="Storage" hint="What's using space, how long things are kept" href="/storage" />
      <NavRow
        label="About Sidekick"
        hint="What it does and how your data stays private"
        href="/onboarding"
      />
    </Page>
  );
}

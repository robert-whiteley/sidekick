import { platformText } from '@/engine/platform-text';
import { Page } from '@/features/settings/Page';
import { NavRow } from '@/features/settings/ui';

export default function SettingsScreen() {
  return (
    <Page title="Settings">
      <NavRow
        label="Assistant"
        hint={platformText('settingsAssistantHint')}
        href="/settings/assistant"
      />
      <NavRow
        label="Camera & audio"
        hint={platformText('settingsCameraHint')}
        href="/settings/camera"
      />
      <NavRow
        label="Connections"
        hint={platformText('settingsConnectionsHint')}
        href="/settings/connections"
      />
      <NavRow
        label="Phone search"
        hint="Photos, folders and files Sidekick may search"
        href="/settings/phone-search"
      />
      <NavRow label="Privacy" hint={platformText('settingsPrivacyHint')} href="/settings/privacy" />
      <NavRow
        label="Phone features"
        hint="What this phone can and can't do"
        href="/settings/features"
      />
      <NavRow
        label="Advanced"
        hint={platformText('settingsAdvancedHint')}
        href="/settings/advanced"
      />
      <NavRow label="Memory" hint="You, people, to-dos, timeline, saved" href="/memory" />
      <NavRow label="Storage" hint="What's using space, how long things are kept" href="/storage" />
      <NavRow
        label="About Sidekick"
        hint="Version, what's new, privacy policy, licences, feedback"
        href="/about"
      />
    </Page>
  );
}

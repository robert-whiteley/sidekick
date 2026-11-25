import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { feedbackMailto } from '@/content/feedback';
import { Page } from '@/features/settings/Page';
import { NavRow, Section } from '@/features/settings/ui';
import { AppText, ListRow } from '@/ui';

/** The support address from app.json expo.extra.support.email (empty until the owner sets one). */
function supportEmail(): string {
  const extra = Constants.expoConfig?.extra as { support?: { email?: string } } | undefined;
  return extra?.support?.email?.trim() ?? '';
}

function deviceInfo() {
  const c = Platform.constants as { Manufacturer?: string; Model?: string; Release?: string };
  const model = [c.Manufacturer, c.Model].filter(Boolean).join(' ') || null;
  const os = Platform.OS === 'android' ? `Android ${c.Release ?? Platform.Version}` : null;
  return { device: model, os };
}

export default function AboutScreen() {
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  const email = supportEmail();
  return (
    <Page title="About">
      <AppText>
        Sidekick {version ?? ''}
        {build ? ` (build ${build})` : ''}
      </AppText>
      <AppText variant="bodySmall" tone="muted">
        Runs on your phone. No accounts, no tracking, nothing sent anywhere unless you turn on
        online lookup or a Google feature.
      </AppText>
      <Section title="Sidekick">
        <NavRow label="What's new" hint="Changes in each version" href="/whats-new" />
        <NavRow
          label="How Sidekick works"
          hint="What it does and how your data stays private"
          href="/onboarding"
        />
        <NavRow label="Privacy policy" href="/about/privacy" />
        <NavRow
          label="Licences"
          hint="Models, data and libraries Sidekick uses"
          href="/about/licences"
        />
      </Section>
      {email ? (
        <Section title="Feedback">
          <ActionRow
            label="Send feedback"
            hint="Opens your email app with a draft you can read and change first. Adds only the app version and phone model; nothing else is attached."
            onPress={() =>
              void Linking.openURL(feedbackMailto(email, { version, build, ...deviceInfo() }))
            }
          />
        </Section>
      ) : null}
    </Page>
  );
}

function ActionRow(props: { label: string; hint: string; onPress: () => void }) {
  return <ListRow title={props.label} supporting={props.hint} onPress={props.onPress} />;
}

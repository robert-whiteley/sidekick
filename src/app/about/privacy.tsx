import { PRIVACY_POLICY_MD } from '@/content/legal';
import { MarkdownView } from '@/features/about/MarkdownView';
import { Page } from '@/features/settings/Page';

export default function PrivacyPolicyScreen() {
  return (
    <Page title="Privacy policy">
      <MarkdownView md={PRIVACY_POLICY_MD} skipTitle />
    </Page>
  );
}

import { THIRD_PARTY_NOTICES_MD } from '@/content/legal';
import { MarkdownView } from '@/features/about/MarkdownView';
import { Page } from '@/features/settings/Page';

export default function LicencesScreen() {
  return (
    <Page title="Licences">
      <MarkdownView md={THIRD_PARTY_NOTICES_MD} skipTitle />
    </Page>
  );
}

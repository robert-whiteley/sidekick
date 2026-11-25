import { View } from 'react-native';

import { CHANGELOG } from '@/content/changelog';
import { Page } from '@/features/settings/Page';
import { styles } from '@/features/settings/ui';
import { AppText } from '@/ui';

/** Every version's changes, newest first (src/content/changelog.ts). */
export default function WhatsNewScreen() {
  return (
    <Page title="What's new">
      {CHANGELOG.map((e) => (
        <View key={e.version} style={styles.group}>
          <AppText variant="titleSmall">Version {e.version}</AppText>
          <AppText variant="bodySmall" tone="muted">
            {formatDate(e.date)}
          </AppText>
          {e.items.map((item, i) => (
            <AppText key={i}>
              {'•  '}
              {item}
            </AppText>
          ))}
        </View>
      ))}
    </Page>
  );
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

import { Text, View } from 'react-native';

import { CHANGELOG } from '@/content/changelog';
import { Page } from '@/features/settings/Page';
import { styles } from '@/features/settings/ui';

/** Every version's changes, newest first (src/content/changelog.ts). */
export default function WhatsNewScreen() {
  return (
    <Page title="What's new">
      {CHANGELOG.map((e) => (
        <View key={e.version} style={styles.section}>
          <Text style={styles.h}>Version {e.version}</Text>
          <Text style={styles.small}>{formatDate(e.date)}</Text>
          {e.items.map((item, i) => (
            <Text key={i} style={styles.body}>
              {'•  '}
              {item}
            </Text>
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

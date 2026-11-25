import { Image, StyleSheet, Text, View } from 'react-native';

import { formatTime, Section, styles } from '@/features/settings/ui';
import type { Moment } from '@/memory/store';

/** Photos and frames Sidekick kept, newest first. */
export function SavedSection({ moments }: { moments: Moment[] }) {
  const photos = moments.filter((m) => m.photoPath);
  return (
    <Section title="Saved">
      {photos.length === 0 && (
        <Text style={styles.hint}>No saved photos yet. Photos you ask about are kept here.</Text>
      )}
      <View style={local.grid}>
        {photos.map((m) => (
          <View key={m.id} style={local.cell}>
            <Image
              source={{ uri: `file://${m.photoPath}` }}
              style={local.thumb}
              accessibilityLabel={m.text}
            />
            <Text style={styles.small} numberOfLines={1}>
              {formatTime(m.at)}
            </Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

const local = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '31%', gap: 2 },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: '#eee' },
});

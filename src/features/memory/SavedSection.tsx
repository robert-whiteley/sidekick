import { Image, StyleSheet, View } from 'react-native';

import { formatTime, Section } from '@/features/settings/ui';
import type { Moment } from '@/memory/store';
import { AppText, radius, space } from '@/ui';

/** Photos and frames Sidekick kept, newest first. */
export function SavedSection({ moments }: { moments: Moment[] }) {
  const photos = moments.filter((m) => m.photoPath);
  return (
    <Section title="Saved">
      {photos.length === 0 && (
        <AppText variant="bodySmall" tone="muted">
          No saved photos yet. Photos you ask about are kept here.
        </AppText>
      )}
      <View style={local.grid}>
        {photos.map((m) => (
          <View key={m.id} style={local.cell}>
            <Image
              source={{ uri: `file://${m.photoPath}` }}
              style={local.thumb}
              accessibilityLabel={m.text}
            />
            <AppText variant="bodySmall" tone="muted" numberOfLines={1}>
              {formatTime(m.at)}
            </AppText>
          </View>
        ))}
      </View>
    </Section>
  );
}

const local = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { width: '31%', gap: space.xxs },
  thumb: { width: '100%', aspectRatio: 1, borderRadius: radius.sm },
});

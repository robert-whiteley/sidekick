import { View } from 'react-native';

import type { Moment } from '@/memory/store';
import { deleteMoment } from '@/memory/store';
import { Button, formatTime, Section, styles } from './ui';

import { who } from '@/features/memory/timeline-logic';
import { AppText, TextButton } from '@/ui';

export { who };

export function MemorySection(props: {
  moments: Moment[];
  hasMore: boolean;
  onMore: () => void;
  onChanged: () => void;
}) {
  return (
    <Section title="Memory">
      {props.moments.length === 0 && (
        <AppText variant="bodySmall" tone="muted">
          Nothing remembered yet.
        </AppText>
      )}
      {props.moments.map((m) => (
        <View key={m.id} style={styles.item}>
          <View style={styles.itemRow}>
            <AppText variant="bodySmall" tone="muted" style={styles.flex}>
              {formatTime(m.at)} · {who(m)}
              {m.place ? ` · ${m.place}` : ''}
              {m.photoPath ? ' · photo' : ''}
            </AppText>
            <TextButton
              title="Delete"
              onPress={async () => {
                await deleteMoment(m.id);
                props.onChanged();
              }}
              accessibilityLabel="Delete memory"
              danger
            />
          </View>
          <AppText numberOfLines={4}>{m.text}</AppText>
        </View>
      ))}
      {props.hasMore && <Button title="Load more" onPress={props.onMore} />}
    </Section>
  );
}

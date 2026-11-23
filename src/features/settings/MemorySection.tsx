import { Pressable, Text, View } from 'react-native';

import type { Moment } from '@/memory/store';
import { deleteMoment } from '@/memory/store';
import { Button, formatTime, Section, styles } from './ui';

export function who(m: Moment): string {
  if (m.kind === 'photo') return 'Photo';
  if (m.kind === 'answer') return 'Asked Sidekick';
  if (m.kind === 'question' || m.isOwner) return 'You';
  return m.speakerName ?? (m.speakerId ? `Voice ${m.speakerId}` : 'Someone');
}

export function MemorySection(props: {
  moments: Moment[];
  hasMore: boolean;
  onMore: () => void;
  onChanged: () => void;
}) {
  return (
    <Section title="Memory">
      {props.moments.length === 0 && <Text style={styles.hint}>Nothing remembered yet.</Text>}
      {props.moments.map((m) => (
        <View key={m.id} style={styles.item}>
          <View style={styles.itemRow}>
            <Text style={[styles.small, styles.flex]}>
              {formatTime(m.at)} · {who(m)}
              {m.place ? ` · ${m.place}` : ''}
              {m.photoPath ? ' · 📷' : ''}
            </Text>
            <Pressable
              onPress={async () => {
                await deleteMoment(m.id);
                props.onChanged();
              }}
              accessibilityLabel="Delete memory"
            >
              <Text style={[styles.link, styles.danger]}>Delete</Text>
            </Pressable>
          </View>
          <Text style={styles.body} numberOfLines={4}>
            {m.text}
          </Text>
        </View>
      ))}
      {props.hasMore && <Button title="Load more" onPress={props.onMore} />}
    </Section>
  );
}

import { Pressable, Text, View } from 'react-native';

import { AudioClip } from '@/features/media/AudioClip';
import { who } from '@/features/settings/MemorySection';
import { Button, Section, styles } from '@/features/settings/ui';
import { deleteMoment, type Moment } from '@/memory/store';
import { groupByDay } from './timeline-logic';

const time = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Everything remembered, by day, newest first. */
export function TimelineSection(props: {
  moments: Moment[];
  hasMore: boolean;
  onMore: () => void;
  onChanged: () => void;
}) {
  const days = groupByDay(props.moments);
  return (
    <Section title="Timeline">
      {days.length === 0 && <Text style={styles.hint}>Nothing remembered yet.</Text>}
      {days.map((d) => (
        <View key={d.day} style={styles.section}>
          <Text style={styles.label}>{d.day}</Text>
          {d.items.map((m) => (
            <View key={m.id} style={styles.item}>
              <View style={styles.itemRow}>
                <Text style={[styles.small, styles.flex]}>
                  {time(m.at)} · {who(m)}
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
              {m.audioPath ? <AudioClip path={m.audioPath} /> : null}
            </View>
          ))}
        </View>
      ))}
      {props.hasMore && <Button title="Load more" onPress={props.onMore} />}
    </Section>
  );
}

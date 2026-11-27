import { StyleSheet, View } from 'react-native';

import { AppText, radius, space, Tappable } from '@/ui';

import type { QueuedMessage } from './send-queue';
import type { ChatTheme } from './theme';

/**
 * Messages sent while Sidekick is answering, in the order they will be answered: faded bubbles
 * with Send now (stops the answer and asks this one next), Edit and Remove.
 */
export function QueuedMessages({
  queue,
  theme,
  editingId,
  onSendNow,
  onEdit,
  onRemove,
}: {
  queue: QueuedMessage[];
  theme: ChatTheme;
  editingId: string | null;
  onSendNow: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return queue.map((m, i) => (
    <View key={m.id} style={styles.row}>
      <View style={[styles.bubble, { backgroundColor: theme.userBubble }]}>
        <AppText variant="chat" style={{ color: theme.userText }}>
          {m.text}
        </AppText>
      </View>
      <View style={styles.actions}>
        <AppText variant="bodySmall" style={{ color: theme.faint }}>
          {editingId === m.id ? 'Editing' : i === 0 ? 'Next' : 'Queued'}
        </AppText>
        <Action label="Send now" onPress={() => onSendNow(m.id)} />
        <Action label="Edit" onPress={() => onEdit(m.id)} />
        <Action label="Remove" onPress={() => onRemove(m.id)} />
      </View>
    </View>
  ));
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Tappable feedback="dim" onPress={onPress} accessibilityRole="button">
      <AppText variant="bodySmall" tone="primary">
        {label}
      </AppText>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-end', gap: space.xs },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    opacity: 0.6,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});

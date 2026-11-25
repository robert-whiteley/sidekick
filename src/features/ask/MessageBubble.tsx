import * as Clipboard from 'expo-clipboard';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import type { ChatMessage } from './chat-logic';
import { Icon } from './Icon';
import { MediaMoment } from './MediaMoment';
import type { ChatTheme } from './theme';
import { WebSearchLink, WebSources } from './WebLookupUi';

/** Long-press a message: copy or share it. */
export function messageActions(text: string) {
  Alert.alert('Message', undefined, [
    { text: 'Copy', onPress: () => void Clipboard.setStringAsync(text) },
    { text: 'Share', onPress: () => void Share.share({ message: text }) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

export function MessageBubble({
  m,
  theme,
  speaking,
  onMute,
}: {
  m: ChatMessage;
  theme: ChatTheme;
  /** This answer is being read out: show a mute button. */
  speaking?: boolean;
  onMute?: () => void;
}) {
  const user = m.role === 'user';
  const text = m.text || (m.pending ? '…' : '');
  return (
    <View style={[styles.row, user && styles.rowUser]}>
      {m.media?.map((media) => (
        <MediaMoment key={`${media.kind}${media.momentAt}${media.path ?? ''}`} media={media} />
      ))}
      {text ? (
        <Pressable
          onLongPress={() => m.text && messageActions(m.text)}
          accessibilityHint="Long-press to copy or share"
          style={user ? [styles.user, { backgroundColor: theme.userBubble }] : styles.assistant}
        >
          <Text style={[styles.text, { color: user ? theme.userText : theme.text }]}>{text}</Text>
        </Pressable>
      ) : null}
      {!user && m.web?.length ? <WebSources sources={m.web} /> : null}
      {!user && !m.pending && m.webAsk?.question ? (
        <WebSearchLink question={m.webAsk.question} query={m.webAsk.query} />
      ) : null}
      {speaking ? (
        <Pressable
          onPress={onMute}
          style={[styles.mute, { borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Mute this answer"
        >
          <Icon name="mute" size={18} color={theme.faint} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', gap: 6 },
  rowUser: { alignItems: 'flex-end' },
  user: { maxWidth: '85%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  assistant: { maxWidth: '100%' },
  text: { fontSize: 17, lineHeight: 25 },
  mute: { borderWidth: 1, borderRadius: 16, padding: 5 },
});

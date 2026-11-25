import * as Clipboard from 'expo-clipboard';
import { Share, StyleSheet, View } from 'react-native';

import { AppText, radius, showDialog, space, Tappable } from '@/ui';

import type { ChatMessage } from './chat-logic';
import { Icon } from './Icon';
import { MediaMoment } from './MediaMoment';
import type { ChatTheme } from './theme';
import { WebSearchLink, WebSources } from './WebLookupUi';

/** Long-press a message: copy or share it. */
export function messageActions(text: string) {
  showDialog('Message', undefined, [
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
        <Tappable
          feedback="none"
          hitSlop={0}
          onLongPress={() => m.text && messageActions(m.text)}
          accessibilityHint="Long-press to copy or share"
          style={user ? [styles.user, { backgroundColor: theme.userBubble }] : styles.assistant}
        >
          <AppText variant="chat" style={{ color: user ? theme.userText : theme.text }}>
            {text}
          </AppText>
        </Tappable>
      ) : null}
      {!user && m.web?.length ? <WebSources sources={m.web} /> : null}
      {!user && !m.pending && m.webAsk?.question ? (
        <WebSearchLink question={m.webAsk.question} query={m.webAsk.query} />
      ) : null}
      {speaking ? (
        <Tappable
          onPress={onMute}
          style={[styles.mute, { borderColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Mute this answer"
        >
          <Icon name="mute" size={18} color={theme.faint} />
        </Tappable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', gap: space.sm },
  rowUser: { alignItems: 'flex-end' },
  user: {
    maxWidth: '85%',
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  assistant: { maxWidth: '100%' },
  mute: { borderWidth: 1, borderRadius: radius.lg, padding: space.xs },
});

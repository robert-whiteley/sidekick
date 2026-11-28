import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { memo } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { openOriginal } from '@/memory/gallery';
import { AppText, Markdown, radius, showDialog, space, Tappable } from '@/ui';

import type { ChatMessage } from './chat-logic';
import { Icon } from './Icon';
import { MediaMoment } from './MediaMoment';
import { reportPicture } from './picture-report';
import type { ChatTheme } from './theme';
import { WebSearchLink, WebSources } from './WebLookupUi';

/** What a long-press can ask the chat to do with a message. */
export type MessageAction = 'edit' | 'retry' | 'read';

/**
 * Long-press a message: copy or share it; an answer can be read aloud. On the last exchange,
 * your question can be edited and the answer tried again (chat-logic.ts lastExchange).
 */
export function messageActions(
  m: ChatMessage,
  redo: boolean,
  onAction?: (m: ChatMessage, action: MessageAction) => void,
) {
  const user = m.role === 'user';
  const act = (a: MessageAction) => () => onAction?.(m, a);
  showDialog(user ? 'Your question' : 'Answer', undefined, [
    ...(redo && onAction
      ? [{ text: user ? 'Edit' : 'Try again', onPress: act(user ? 'edit' : 'retry') }]
      : []),
    ...(!user && onAction ? [{ text: 'Read aloud', onPress: act('read') }] : []),
    { text: 'Copy', onPress: () => void Clipboard.setStringAsync(m.text) },
    { text: 'Share', onPress: () => void Share.share({ message: m.text }) },
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

/**
 * One chat message. Memoised: while an answer streams only its own bubble re-renders, so a long
 * chat doesn't slow every new word (each word used to re-render every bubble on screen).
 */
export const MessageBubble = memo(function MessageBubble({
  m,
  theme,
  speaking,
  onMute,
  redo = false,
  onAction,
}: {
  m: ChatMessage;
  theme: ChatTheme;
  /** This answer is being read out: show a mute button. */
  speaking?: boolean;
  onMute?: () => void;
  /** Part of the last exchange: Edit (question) / Try again (answer) on long-press. */
  redo?: boolean;
  /** Stable (memo): Edit, Try again or Read aloud chosen on this message. */
  onAction?: (m: ChatMessage, action: MessageAction) => void;
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
          onLongPress={() => m.text && !m.pending && messageActions(m, redo, onAction)}
          accessibilityHint={
            redo
              ? user
                ? 'Long-press to edit, copy or share'
                : 'Long-press to try again, read aloud, copy or share'
              : 'Long-press to copy or share'
          }
          style={user ? [styles.user, { backgroundColor: theme.userBubble }] : styles.assistant}
        >
          {user ? (
            <AppText variant="chat" style={{ color: theme.userText }}>
              {text}
            </AppText>
          ) : (
            // Typed answers may have lists, steps, bold or a small table (prompts.ts).
            <Markdown text={text} color={theme.text} />
          )}
        </Tappable>
      ) : null}
      {!user && m.stopped && !m.pending ? (
        <AppText variant="bodySmall" style={{ color: theme.faint }}>
          Stopped
        </AppText>
      ) : null}
      {!user && m.picture ? (
        <Tappable
          feedback="dim"
          onPress={() => reportPicture(m.picture!.prompt)}
          accessibilityRole="button"
          accessibilityHint="Tell the developer this picture is harmful or wrong"
        >
          <AppText variant="bodySmall" style={{ color: theme.faint }}>
            Report this picture
          </AppText>
        </Tappable>
      ) : null}
      {!user && !m.pending && m.link ? (
        <Tappable
          feedback="dim"
          onPress={() => {
            // A found photo or file opens in the phone's own app; else (or if it can't) the screen.
            const l = m.link!;
            if (!l.open || !openOriginal(l.open)) router.push(l.href as never);
          }}
          style={[styles.linkButton, { borderColor: theme.border }]}
          accessibilityRole="button"
        >
          <AppText variant="bodySmall" tone="primary">
            {m.link.label}
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
});

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
  linkButton: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
});

// ui-exception: the chat composer is a one-off rounded message field with inline buttons, not a form field
import { StyleSheet, TextInput, View } from 'react-native';

import { radius, space, Tappable, type as typeScale } from '@/ui';

import { Icon } from './Icon';
import type { ChatTheme } from './theme';

/**
 * "Ask Sidekick": the camera button on the left; a mic when the field is empty (hold to talk, or
 * tap to talk until tapped again), a send arrow when there is text. While answering, Stop sits
 * beside them: what is sent meanwhile waits its turn (send-queue.ts). Long-press send: Off the
 * record, or while answering, Send now. The paperclip attaches a file to ask about (any kind;
 * not in hands-free). `large`: hands-free (driving / walking) sizes.
 */
export function Composer({
  theme,
  value,
  onChange,
  placeholder,
  onSend,
  onSendLong,
  answering,
  onStop,
  micOn,
  onMicIn,
  onMicOut,
  cameraOn,
  onCamera,
  onAttach,
  large = false,
}: {
  theme: ChatTheme;
  value: string;
  onChange: (t: string) => void;
  placeholder: string;
  onSend: () => void;
  onSendLong: () => void;
  answering: boolean;
  onStop: () => void;
  micOn: boolean;
  onMicIn: () => void;
  onMicOut: () => void;
  cameraOn: boolean;
  onCamera: () => void;
  onAttach?: () => void;
  large?: boolean;
}) {
  const hasText = value.trim().length > 0;
  const round = [styles.round, large && styles.roundLarge];
  const action = [styles.action, large && styles.actionLarge];
  const icon = large ? 32 : 22;
  return (
    <View style={styles.row}>
      <Tappable
        feedback="dim"
        onPress={onCamera}
        style={[round, { backgroundColor: cameraOn ? theme.accent : theme.field }]}
        accessibilityRole="switch"
        accessibilityState={{ checked: cameraOn }}
        accessibilityLabel="Camera"
      >
        <Icon
          name={cameraOn ? 'cameraOff' : 'camera'}
          size={icon}
          color={cameraOn ? theme.bg : theme.icon}
        />
      </Tappable>
      <View style={[styles.field, large && styles.fieldLarge, { backgroundColor: theme.field }]}>
        <TextInput
          style={[styles.input, { color: theme.text }]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={theme.faint}
          returnKeyType="send"
          onSubmitEditing={onSend}
          multiline
          submitBehavior="submit"
        />
        {onAttach && !large ? (
          <Tappable
            feedback="dim"
            onPress={onAttach}
            style={action}
            accessibilityRole="button"
            accessibilityLabel="Attach a file"
            accessibilityHint="A document, spreadsheet, picture, recording, video or any file to ask about"
          >
            <Icon name="attach" size={icon} color={theme.icon} />
          </Tappable>
        ) : null}
        {answering ? (
          <Tappable
            feedback="dim"
            onPress={onStop}
            style={[action, { borderColor: theme.accent }, styles.stop]}
            accessibilityRole="button"
            accessibilityLabel="Stop"
          >
            <Icon name="stop" size={icon - 4} color={theme.accent} />
          </Tappable>
        ) : null}
        {hasText ? (
          <Tappable
            feedback="dim"
            onPress={onSend}
            onLongPress={onSendLong}
            style={[action, { backgroundColor: theme.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityHint={
              answering
                ? 'Long-press to send now, stopping the answer'
                : 'Long-press to send Off the record'
            }
          >
            <Icon name="send" size={icon - 2} color={theme.bg} />
          </Tappable>
        ) : (
          <Tappable
            feedback="dim"
            onPressIn={onMicIn}
            onPressOut={onMicOut}
            style={[action, { backgroundColor: micOn ? theme.danger : 'transparent' }]}
            accessibilityRole="button"
            accessibilityLabel={micOn ? 'Listening, tap when done' : 'Talk'}
            accessibilityHint="Hold to talk, or tap to talk and tap again when done"
          >
            <Icon name="mic" size={icon} color={micOn ? theme.bg : theme.icon} />
          </Tappable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: radius.xl,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    minHeight: 44,
  },
  input: { flex: 1, ...typeScale.chat, maxHeight: 120, paddingVertical: space.sm },
  action: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundLarge: { width: 64, height: 64, borderRadius: 32 },
  fieldLarge: { minHeight: 64, borderRadius: 32 },
  actionLarge: { width: 56, height: 56, borderRadius: 28 },
  stop: { borderWidth: 2 },
});

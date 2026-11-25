import { useEffect, useRef } from 'react';
// ui-exception: the chat composer is a one-off rounded message field with inline buttons, not a form field
import { StyleSheet, TextInput, View } from 'react-native';

import { radius, space, Tappable, type as typeScale } from '@/ui';

import { Icon } from './Icon';
import type { ChatTheme } from './theme';

/**
 * "Ask Sidekick": the camera button on the left; a mic when the field is empty (hold to talk, or
 * tap to talk until tapped again), a send arrow when there is text, Stop while answering.
 * Long-press send to ask Off the record. `large`: hands-free (driving / walking) sizes.
 */
export function Composer({
  theme,
  value,
  onChange,
  placeholder,
  onSend,
  onSendLong,
  busy,
  answering,
  onStop,
  micOn,
  onMicIn,
  onMicOut,
  cameraOn,
  onCamera,
  large = false,
}: {
  theme: ChatTheme;
  value: string;
  onChange: (t: string) => void;
  placeholder: string;
  onSend: () => void;
  onSendLong: () => void;
  busy: boolean;
  answering: boolean;
  onStop: () => void;
  micOn: boolean;
  onMicIn: () => void;
  onMicOut: () => void;
  cameraOn: boolean;
  onCamera: () => void;
  large?: boolean;
}) {
  const hasText = value.trim().length > 0;
  // Stop turns back into the mic where the finger is: a tap meant for Stop just as the answer
  // ends must not start listening.
  const stoppedAt = useRef(0);
  const ignored = useRef(false);
  useEffect(() => {
    if (!answering) stoppedAt.current = Date.now();
  }, [answering]);
  const micIn = () => {
    ignored.current = micGuard(stoppedAt.current, Date.now());
    if (!ignored.current) onMicIn();
  };
  const micOut = () => {
    if (!ignored.current) onMicOut();
    ignored.current = false;
  };
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
        {answering ? (
          <Tappable
            feedback="dim"
            onPress={onStop}
            style={[action, { backgroundColor: theme.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Stop"
          >
            <Icon name="stop" size={icon - 2} color={theme.bg} />
          </Tappable>
        ) : hasText ? (
          <Tappable
            feedback="dim"
            onPress={onSend}
            onLongPress={onSendLong}
            disabled={busy}
            style={[action, { backgroundColor: theme.accent }, busy && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityHint="Long-press to send Off the record"
          >
            <Icon name="send" size={icon - 2} color={theme.bg} />
          </Tappable>
        ) : (
          <Tappable
            feedback="dim"
            onPressIn={micIn}
            onPressOut={micOut}
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

/** True when a mic press comes so soon after Stop disappeared that it was meant for Stop. */
export const micGuard = (stoppedAt: number, now: number) => now - stoppedAt < 800;

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
  disabled: { opacity: 0.5 },
});

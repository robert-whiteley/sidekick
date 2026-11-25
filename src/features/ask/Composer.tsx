import { Pressable, StyleSheet, TextInput, View } from 'react-native';

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
  const round = [styles.round, large && styles.roundLarge];
  const action = [styles.action, large && styles.actionLarge];
  const icon = large ? 32 : 22;
  return (
    <View style={styles.row}>
      <Pressable
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
      </Pressable>
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
          <Pressable
            onPress={onStop}
            style={[action, { backgroundColor: theme.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Stop"
          >
            <Icon name="stop" size={icon - 2} color={theme.bg} />
          </Pressable>
        ) : hasText ? (
          <Pressable
            onPress={onSend}
            onLongPress={onSendLong}
            disabled={busy}
            style={[action, { backgroundColor: theme.accent }, busy && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityHint="Long-press to send Off the record"
          >
            <Icon name="send" size={icon - 2} color={theme.bg} />
          </Pressable>
        ) : (
          <Pressable
            onPressIn={onMicIn}
            onPressOut={onMicOut}
            style={[action, { backgroundColor: micOn ? theme.danger : 'transparent' }]}
            accessibilityRole="button"
            accessibilityLabel={micOn ? 'Listening, tap when done' : 'Talk'}
            accessibilityHint="Hold to talk, or tap to talk and tap again when done"
          >
            <Icon name="mic" size={icon} color={micOn ? '#fff' : theme.icon} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
    minHeight: 44,
  },
  input: { flex: 1, fontSize: 17, maxHeight: 120, paddingVertical: 8 },
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

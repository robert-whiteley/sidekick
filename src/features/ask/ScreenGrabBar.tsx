import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ScreenGrab } from '@/engine/entry-points';

/** The screenshot attached by "ask about my screen", with Save and remove. */
export function ScreenGrabBar(props: {
  grab: ScreenGrab;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.bar}>
      {props.grab.shot ? (
        <Image source={{ uri: `file://${props.grab.shot}` }} style={styles.thumb} />
      ) : null}
      <Text style={styles.text} numberOfLines={2}>
        {props.grab.shared
          ? 'Asking about the shared picture'
          : props.grab.shot
            ? 'Asking about your screen'
            : 'Asking about your screen (text only)'}
      </Text>
      <Pressable onPress={props.onSave} accessibilityRole="button" style={styles.btn}>
        <Text style={styles.btnText}>Save</Text>
      </Pressable>
      <Pressable
        onPress={props.onClose}
        accessibilityRole="button"
        accessibilityLabel="Remove screenshot"
        style={styles.btn}
      >
        <Text style={styles.btnText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#f2f2f5',
  },
  thumb: { width: 36, height: 64, borderRadius: 4, backgroundColor: '#ddd' },
  text: { flex: 1, fontSize: 14, color: '#333' },
  btn: { paddingHorizontal: 10, paddingVertical: 6 },
  btnText: { fontSize: 15, color: '#2f6fed' },
});

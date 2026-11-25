import { Image, StyleSheet, View } from 'react-native';

import type { ScreenGrab } from '@/engine/entry-points';
import { AppText, IconButton, makeStyles, radius, space, TextButton } from '@/ui';

/** The screenshot attached by "ask about my screen", with Save and remove. */
export function ScreenGrabBar(props: {
  grab: ScreenGrab;
  onSave: () => void;
  onClose: () => void;
}) {
  const s = useStyles();
  return (
    <View style={s.bar}>
      {props.grab.shot ? (
        <Image source={{ uri: `file://${props.grab.shot}` }} style={s.thumb} />
      ) : null}
      <AppText variant="bodySmall" style={styles.text} numberOfLines={2}>
        {props.grab.shared
          ? 'Asking about the shared picture'
          : props.grab.shot
            ? 'Asking about your screen'
            : 'Asking about your screen (text only)'}
      </AppText>
      <TextButton title="Save" onPress={props.onSave} />
      <IconButton
        name="close"
        size={20}
        onPress={props.onClose}
        accessibilityLabel="Remove screenshot"
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    backgroundColor: c.surface,
  },
  thumb: { width: 36, height: 64, borderRadius: space.xs, backgroundColor: c.surfaceHigh },
}));

const styles = StyleSheet.create({ text: { flex: 1 } });

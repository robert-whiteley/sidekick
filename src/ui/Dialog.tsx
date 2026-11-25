import { useSyncExternalStore } from 'react';
import {
  Alert,
  type AlertButton,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { Button } from './Button';
import { AppText } from './Text';
import { makeStyles } from './theme';
import { radius, space } from './tokens';

type Req = {
  title: string;
  message?: string;
  buttons: AlertButton[];
  onDismiss?: () => void;
};

let current: Req | null = null;
let hosted = 0;
const listeners = new Set<() => void>();
const set = (r: Req | null) => {
  current = r;
  listeners.forEach((l) => l());
};

/**
 * The app's alert dialog, drawn the same on Android and iOS (the system Alert looks different on
 * each). Same arguments as Alert.alert; falls back to it when no DialogHost is mounted.
 */
export function showDialog(
  title: string,
  message?: string,
  buttons: AlertButton[] = [{ text: 'OK' }],
  opts?: { onDismiss?: () => void },
) {
  if (!hosted) return Alert.alert(title, message, buttons, { cancelable: true, ...opts });
  set({ title, message, buttons, onDismiss: opts?.onDismiss });
}

/** Mount once at the root (src/app/_layout.tsx). */
export function DialogHost() {
  const req = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      hosted++;
      return () => {
        listeners.delete(l);
        hosted--;
      };
    },
    () => current,
  );
  const s = useStyles();
  if (!req) return null;
  const close = (b?: AlertButton) => {
    set(null);
    if (b) b.onPress?.();
    else req.onDismiss?.();
  };
  const cancel = req.buttons.find((b) => b.style === 'cancel');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => close(cancel)}>
      <View style={styles.center}>
        <Pressable
          style={[StyleSheet.absoluteFill, s.scrim]}
          onPress={() => close(cancel)}
          accessibilityLabel="Close"
        />
        <View style={s.box} accessibilityViewIsModal>
          <AppText variant="titleSmall" accessibilityRole="header">
            {req.title}
          </AppText>
          {req.message ? (
            <ScrollView style={styles.body}>
              <AppText tone="muted">{req.message}</AppText>
            </ScrollView>
          ) : null}
          <View style={styles.actions}>
            {req.buttons.map((b, i) => (
              <Button
                key={`${b.text}${i}`}
                title={b.text ?? 'OK'}
                variant={
                  b.style === 'cancel' ? 'text' : i === req.buttons.length - 1 ? 'filled' : 'tonal'
                }
                danger={b.style === 'destructive'}
                onPress={() => close(b)}
              />
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  scrim: { backgroundColor: c.scrim },
  box: {
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    padding: space.xl,
    gap: space.md,
    maxHeight: '80%',
    width: '100%',
    maxWidth: 400,
  },
}));

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  body: { flexGrow: 0 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
});

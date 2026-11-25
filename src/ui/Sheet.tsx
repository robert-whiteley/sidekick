import { type ReactNode, useContext } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { AppText } from './Text';
import { makeStyles } from './theme';
import { radius, space } from './tokens';

/**
 * A bottom sheet (the same on Android and iOS): pickers and short lists of choices slide up
 * from the bottom; tapping outside or the back gesture closes it.
 */
export function Sheet(props: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const s = useStyles();
  const bottom = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="slide"
      onRequestClose={props.onClose}
      statusBarTranslucent
    >
      <View style={styles.fill}>
        <Pressable style={s.scrim} onPress={props.onClose} accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: bottom + space.sm }]}>
          <View style={s.grabber} />
          <AppText variant="titleSmall" style={styles.title} accessibilityRole="header">
            {props.title}
          </AppText>
          <ScrollView style={styles.body}>{props.children}</ScrollView>
          {props.footer ? <View style={styles.footer}>{props.footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: c.scrim },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space.sm,
    maxHeight: '80%',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
    marginBottom: space.md,
  },
}));

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  title: { paddingHorizontal: space.lg, marginBottom: space.sm },
  body: { flexGrow: 0, paddingHorizontal: space.lg },
  footer: { paddingHorizontal: space.lg, paddingTop: space.sm },
});

import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ScrollView,
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';

import { AppText } from './Text';
import { makeStyles, useColors } from './theme';
import { radius, space, type } from './tokens';

/** A settings / memory page: title in the header, scrolling themed content. */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView
        style={s.page}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </>
  );
}

/** A group of rows under a section header (muted, sentence case on both platforms). */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="label" tone="muted" accessibilityRole="header" style={styles.header}>
        {title}
      </AppText>
      {children}
    </View>
  );
}

/** A filled card (drafts, notices that need a decision, media). */
export function Card({ children, tone }: { children: ReactNode; tone?: 'danger' }) {
  const s = useStyles();
  return <View style={[s.card, tone === 'danger' && s.cardDanger]}>{children}</View>;
}

export function Divider() {
  const c = useColors();
  return <View style={[styles.divider, { backgroundColor: c.border }]} />;
}

/** A themed text field (filled style). */
export function TextField(
  props: TextInputProps & { label?: string; containerStyle?: StyleProp<ViewStyle> },
) {
  const c = useColors();
  const s = useStyles();
  const { label, style, containerStyle, ...rest } = props;
  return (
    <View style={[styles.field, containerStyle]}>
      {label ? (
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
      ) : null}
      <TextInput
        placeholderTextColor={c.faint}
        selectionColor={c.primary}
        accessibilityLabel={label ?? props.placeholder}
        {...rest}
        style={[s.input, style]}
      />
    </View>
  );
}

/** Supporting paragraph text on a page (explanations under a section header). */
export function Paragraph({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'default' | 'danger';
}) {
  return (
    <AppText variant="bodySmall" tone={tone}>
      {children}
    </AppText>
  );
}

const useStyles = makeStyles((c) => ({
  page: { flex: 1, backgroundColor: c.bg },
  card: { backgroundColor: c.surface, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  cardDanger: { borderWidth: 1, borderColor: c.danger },
  input: {
    ...type.body,
    color: c.text,
    backgroundColor: c.surface,
    borderRadius: radius.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.muted,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 48,
  },
}));

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxxl,
    gap: space.sm,
  },
  section: { marginTop: space.lg, gap: space.xs },
  header: { paddingTop: space.sm, paddingBottom: space.xs },
  divider: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  field: { gap: space.xs },
});

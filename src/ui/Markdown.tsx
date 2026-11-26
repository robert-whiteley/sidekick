import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { parseMarkdown, type Span } from './markdown-logic';
import { AppText } from './Text';
import { makeStyles } from './theme';
import { radius, space, type TypeVariant } from './tokens';

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.bold || s.italic ? (
          // Nested in an AppText: inherits its size and colour.
          <Text key={i} style={[s.bold && styles.bold, s.italic && styles.italic]}>
            {s.text}
          </Text>
        ) : (
          s.text
        ),
      )}
    </>
  );
}

/**
 * A typed answer with simple formatting (lists, steps, bold, small tables; markdown-logic.ts),
 * in the screen's colour scheme. Plain text looks exactly like an AppText.
 */
export const Markdown = memo(function Markdown({
  text,
  color,
  variant = 'chat',
}: {
  text: string;
  /** Text colour (the chat's own theme); default the scheme's text colour. */
  color?: string;
  variant?: TypeVariant;
}) {
  const s = useStyles();
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  const tone = color ? { color } : undefined;
  return (
    <View style={styles.col}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'para':
            return (
              <AppText key={i} variant={variant} style={tone}>
                <Spans spans={b.spans} />
              </AppText>
            );
          case 'heading':
            return (
              <AppText key={i} variant={variant} style={[tone, styles.bold]}>
                <Spans spans={b.spans} />
              </AppText>
            );
          case 'item':
            return (
              <View key={i} style={[styles.item, { marginLeft: b.indent * space.lg }]}>
                <AppText variant={variant} style={[tone, styles.marker]}>
                  {b.marker}
                </AppText>
                <AppText variant={variant} style={[tone, styles.flex]}>
                  <Spans spans={b.spans} />
                </AppText>
              </View>
            );
          case 'table':
            return (
              <View key={i} style={s.table} accessibilityRole="summary">
                {[b.header, ...b.rows].map((row, r) => (
                  <View key={r} style={[styles.tr, r > 0 && s.rowLine, r === 0 && s.head]}>
                    {b.header.map((_, c) => (
                      <AppText
                        key={c}
                        variant="bodySmall"
                        style={[tone, styles.td, r === 0 && styles.bold]}
                      >
                        <Spans spans={row[c] ?? []} />
                      </AppText>
                    ))}
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  col: { gap: space.sm },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  item: { flexDirection: 'row', gap: space.sm },
  marker: { minWidth: space.lg },
  flex: { flex: 1 },
  tr: { flexDirection: 'row' },
  td: { flex: 1, paddingHorizontal: space.sm, paddingVertical: space.xs },
});

const useStyles = makeStyles((c) => ({
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    borderRadius: radius.md,
    overflow: 'hidden' as const,
  },
  head: { backgroundColor: c.surface },
  rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
}));

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { parseMarkdown } from '@/content/markdown-lite';
import { AppText, makeStyles, space } from '@/ui';

/** Renders the bundled legal texts (see src/content/markdown-lite.ts). */
export function MarkdownView({ md, skipTitle }: { md: string; skipTitle?: boolean }) {
  const blocks = useMemo(() => {
    const all = parseMarkdown(md);
    return skipTitle && all[0]?.type === 'heading' ? all.slice(1) : all;
  }, [md, skipTitle]);
  const t = useStyles();
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        const prev = blocks[i - 1];
        switch (b.type) {
          case 'heading':
            return (
              <AppText
                key={i}
                variant={b.level <= 2 ? 'titleSmall' : 'bodyStrong'}
                style={b.level <= 2 ? styles.h2 : styles.h3}
                accessibilityRole="header"
              >
                {b.text}
              </AppText>
            );
          case 'paragraph':
            return (
              <AppText key={i} variant="bodySmall">
                {b.text}
              </AppText>
            );
          case 'item':
            return (
              <AppText
                key={i}
                variant="bodySmall"
                style={{ paddingLeft: space.md + b.depth * space.lg }}
              >
                {'•  '}
                {b.text}
              </AppText>
            );
          case 'row':
            // The first row of a table is its header ("Component | Licence"): skip it.
            if (prev?.type !== 'row') return null;
            return (
              <View key={i} style={t.row}>
                <AppText variant="bodySmall">{b.cells[0]}</AppText>
                {b.cells.slice(1).map((c, j) => (
                  <AppText key={j} variant="caption" tone="muted">
                    {c}
                  </AppText>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  h2: { marginTop: space.md },
  h3: { marginTop: space.sm },
});

const useStyles = makeStyles((c) => ({
  row: { paddingVertical: space.sm, borderBottomWidth: 1, borderColor: c.border, gap: space.xxs },
}));

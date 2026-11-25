import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { parseMarkdown } from '@/content/markdown-lite';

/** Renders the bundled legal texts (see src/content/markdown-lite.ts). */
export function MarkdownView({ md, skipTitle }: { md: string; skipTitle?: boolean }) {
  const blocks = useMemo(() => {
    const all = parseMarkdown(md);
    return skipTitle && all[0]?.type === 'heading' ? all.slice(1) : all;
  }, [md, skipTitle]);
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        const prev = blocks[i - 1];
        switch (b.type) {
          case 'heading':
            return (
              <Text key={i} style={b.level <= 2 ? styles.h2 : styles.h3} accessibilityRole="header">
                {b.text}
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={i} style={styles.body}>
                {b.text}
              </Text>
            );
          case 'item':
            return (
              <Text key={i} style={[styles.body, { paddingLeft: 12 + b.depth * 16 }]}>
                {'•  '}
                {b.text}
              </Text>
            );
          case 'row':
            // The first row of a table is its header ("Component | Licence"): skip it.
            if (prev?.type !== 'row') return null;
            return (
              <View key={i} style={styles.row}>
                <Text style={styles.cellMain}>{b.cells[0]}</Text>
                {b.cells.slice(1).map((c, j) => (
                  <Text key={j} style={styles.cell}>
                    {c}
                  </Text>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  h2: { fontSize: 18, fontWeight: '600', marginTop: 12 },
  h3: { fontSize: 16, fontWeight: '600', marginTop: 8 },
  body: { fontSize: 15, lineHeight: 21 },
  row: { paddingVertical: 6, borderBottomWidth: 1, borderColor: '#eee', gap: 2 },
  cellMain: { fontSize: 15, lineHeight: 20 },
  cell: { fontSize: 13, lineHeight: 18, color: '#666' },
});

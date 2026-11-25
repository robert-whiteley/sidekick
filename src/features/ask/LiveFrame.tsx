import { useEffect, useState } from 'react';
import { Image, StyleSheet } from 'react-native';

import { latestFramePaths } from '@/memory/frames';

/** While live camera memory runs, the view shows its newest frame (the recorder holds the camera). */
export function LiveFrame() {
  const [path, setPath] = useState<string | null>(() => latestFramePaths(1)[0] ?? null);
  useEffect(() => {
    const t = setInterval(() => setPath(latestFramePaths(1)[0] ?? null), 700);
    return () => clearInterval(t);
  }, []);
  if (!path) return null;
  return <Image source={{ uri: `file://${path}` }} style={styles.frame} fadeDuration={0} />;
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: '#000' },
});

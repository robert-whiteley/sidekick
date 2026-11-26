import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type GestureResponderEvent,
  Image,
  type LayoutChangeEvent,
  StyleSheet,
  View,
} from 'react-native';

import { brushDots, fitRect, toPhoto } from '@/features/erase/erase-logic';
import { SaveShare } from '@/features/media/MomentPlayer';
import { erasePhoto } from '@/engine/photo-edit';
import { AppText, Button, ButtonRow, space, useColors } from '@/ui';

/** Brush radius as a fraction of the photo's shorter edge. */
const RADIUS = 0.035;

const fileUri = (p: string) => (p.includes('://') ? p : `file://${p}`);

/**
 * Erase an object: brush over it (or tap it), then Erase. MI-GAN fills the brushed area on the
 * phone (PhotoEdit.kt). The original is never changed; each result is a new copy to Save or
 * Share, and "Erase more" carries on from it. Opened from the chat's "Brush over it" button.
 */
export default function EraseScreen() {
  const c = useColors();
  const { photo } = useLocalSearchParams<{ photo?: string }>();
  const [current, setCurrent] = useState<string | null>(photo ?? null);
  const [history, setHistory] = useState<string[]>([]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [strokes, setStrokes] = useState<number[][]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const drawing = useRef<number[] | null>(null);

  useEffect(() => {
    if (!current) return;
    Image.getSize(
      fileUri(current),
      (w, h) => setSize({ w, h }),
      () => setStatus("Couldn't open the photo."),
    );
  }, [current]);

  const rect = useMemo(() => (size ? fitRect(size, box) : null), [size, box]);

  const point = (e: GestureResponderEvent) => {
    if (!rect) return null;
    return toPhoto(e.nativeEvent.locationX, e.nativeEvent.locationY, rect);
  };
  const start = (e: GestureResponderEvent) => {
    const p = point(e);
    if (!p || busy) return;
    drawing.current = [p.x, p.y];
    setStrokes((s) => [...s, drawing.current!]);
  };
  const move = (e: GestureResponderEvent) => {
    const p = point(e);
    if (!p || !drawing.current) return;
    drawing.current.push(p.x, p.y);
    setStrokes((s) => [...s.slice(0, -1), [...drawing.current!]]);
  };

  const erase = async () => {
    if (!current || !strokes.length) return;
    setBusy(true);
    setStatus('Filling it in…');
    try {
      const r = await erasePhoto(current, strokes, RADIUS, setStatus);
      setHistory((h) => [...h, current]);
      setCurrent(r.path);
      setStrokes([]);
      setStatus(`Done in ${(r.ms / 1000).toFixed(1)} s. Not right? Undo, or brush a bit wider.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Sorry, I couldn't erase that.");
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    if (strokes.length) return setStrokes((s) => s.slice(0, -1));
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setCurrent(prev);
    setStatus('');
  };

  const dots = rect && size ? brushDots(strokes, rect, RADIUS * Math.min(rect.w, rect.h)) : [];
  const edited = history.length > 0;

  return (
    <View style={[styles.page, { backgroundColor: c.bg }]}>
      <Stack.Screen options={{ title: 'Erase' }} />
      <AppText variant="bodySmall" tone="muted">
        Brush over what to remove, a little wider than it. Then tap Erase.
      </AppText>
      <View
        style={styles.canvas}
        onLayout={(e: LayoutChangeEvent) =>
          setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={start}
        onResponderMove={move}
        onResponderRelease={() => (drawing.current = null)}
        accessibilityLabel="Photo. Drag over what to remove."
      >
        {current && rect ? (
          <Image
            source={{ uri: fileUri(current) }}
            style={{
              position: 'absolute',
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
            }}
            resizeMode="stretch"
          />
        ) : null}
        {dots.map((d, i) => (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: d.x - d.r,
              top: d.y - d.r,
              width: d.r * 2,
              height: d.r * 2,
              borderRadius: d.r,
              backgroundColor: c.danger,
              opacity: 0.45,
            }}
          />
        ))}
      </View>
      {status ? (
        <AppText variant="bodySmall" tone="muted">
          {status}
        </AppText>
      ) : null}
      <ButtonRow>
        <Button
          title="Undo"
          variant="outlined"
          disabled={busy || (!strokes.length && !edited)}
          onPress={undo}
        />
        <Button
          title={edited && !strokes.length ? 'Erase more' : 'Erase'}
          variant="filled"
          busy={busy}
          disabled={busy || !strokes.length}
          onPress={() => void erase()}
        />
      </ButtonRow>
      {edited && current && !busy ? <SaveShare file={current} kind="photo" topic="edits" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: space.lg, gap: space.md },
  canvas: { flex: 1, overflow: 'hidden' },
});

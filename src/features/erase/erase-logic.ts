/**
 * The erase screen's pure parts: where the photo sits on screen, touch → photo coordinates
 * (0..1, what PhotoEdit.kt's erase takes), and the brush dots drawn over the photo. Tested in
 * __tests__/erase-test.ts.
 */
export type Rect = { x: number; y: number; w: number; h: number };

/** The photo ([size]) fitted inside [box], centred, keeping its shape. */
export function fitRect(size: { w: number; h: number }, box: { w: number; h: number }): Rect {
  if (size.w <= 0 || size.h <= 0 || box.w <= 0 || box.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const s = Math.min(box.w / size.w, box.h / size.h);
  const w = size.w * s;
  const h = size.h * s;
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
}

/** A touch at (x, y) in the box → 0..1 of the photo, or null outside it. */
export function toPhoto(x: number, y: number, r: Rect): { x: number; y: number } | null {
  if (r.w <= 0 || r.h <= 0) return null;
  const px = (x - r.x) / r.w;
  const py = (y - r.y) / r.h;
  if (px < -0.02 || py < -0.02 || px > 1.02 || py > 1.02) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(px), y: clamp(py) };
}

/**
 * Circles that show the brushed area: each stroke's points, with in-between dots so a fast
 * swipe still looks continuous. [radius] in screen pixels. Capped so a long scribble stays fast.
 */
export function brushDots(
  strokes: number[][],
  r: Rect,
  radius: number,
  max = 1500,
): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  const step = Math.max(2, radius * 0.6);
  for (const s of strokes) {
    let px: number | null = null;
    let py: number | null = null;
    for (let i = 0; i + 1 < s.length; i += 2) {
      const x = r.x + s[i] * r.w;
      const y = r.y + s[i + 1] * r.h;
      if (px !== null && py !== null) {
        const d = Math.hypot(x - px, y - py);
        const n = Math.floor(d / step);
        for (let k = 1; k < n; k++)
          out.push({ x: px + ((x - px) * k) / n, y: py + ((y - py) * k) / n, r: radius });
      }
      out.push({ x, y, r: radius });
      px = x;
      py = y;
      if (out.length >= max) return out;
    }
  }
  return out;
}

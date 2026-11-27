/** One speed-run result, logged as `[speed] {json}`. */
export type SpeedResult = {
  test: string;
  variant: string;
  ms: number;
  firstTokenMs?: number;
  audioSec?: number;
  /** Chat model: tokens written and their speed (LiteRT-LM's own count). */
  decodeTokens?: number;
  decodeTokPerSec?: number;
  ok: boolean;
  text: string;
};

/** Words in an answer (for words per second next to tokens per second). */
export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;

export function speedLine(r: SpeedResult): string {
  const words = r.decodeTokens !== undefined ? { words: wordCount(r.text) } : {};
  return `[speed] ${JSON.stringify({ ...r, ...words, text: r.text.replace(/\s+/g, ' ').trim().slice(0, 80) })}`;
}

function bytesFromBase64(b64: string, max: number): Uint8Array {
  const bin = atob(b64.slice(0, Math.ceil(max / 3) * 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Length in seconds of a PCM WAV given as base64 (reads the header; null if not a WAV). */
export function wavSeconds(b64: string): number | null {
  const h = bytesFromBase64(b64, 4096);
  const v = new DataView(h.buffer);
  const tag = (o: number) => String.fromCharCode(h[o], h[o + 1], h[o + 2], h[o + 3]);
  if (h.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let byteRate = 0;
  for (let o = 12; o + 8 <= h.length;) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') byteRate = v.getUint32(o + 16, true);
    if (id === 'data') {
      if (!byteRate) return null;
      const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
      const fileBytes = (b64.length / 4) * 3 - pad;
      return Math.min(size, fileBytes - o - 8) / byteRate;
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

/** Calls (and awaits) the first of [names] that the native module has; returns its name, or null. */
export async function callIfExists(
  mod: object,
  names: string[],
  ...args: unknown[]
): Promise<string | null> {
  const m = mod as Record<string, unknown>;
  for (const n of names) {
    const f = m[n];
    if (typeof f === 'function') {
      await (f as (...a: unknown[]) => unknown).apply(mod, args);
      return n;
    }
  }
  return null;
}

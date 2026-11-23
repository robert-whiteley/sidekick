/**
 * Turns a wake phrase ("Hey Sidekick") into the token line the keyword spotter needs. This is
 * sentencepiece segmentation using the model's bpe.model (a unigram model despite the name): the
 * split whose pieces have the highest total score.
 */
export type Vocab = Map<string, number>; // piece -> score

/** Reads the pieces and scores out of a sentencepiece ModelProto (protobuf). */
export function parseSentencepiece(bytes: Uint8Array): Vocab {
  const vocab: Vocab = new Map();
  let pos = 0;
  const varint = (buf: Uint8Array, p: { i: number }) => {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = buf[p.i++];
      v += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return v;
      shift += 7;
    }
  };
  const p = { i: pos };
  while (p.i < bytes.length) {
    const key = varint(bytes, p);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 2) {
      const len = varint(bytes, p);
      const start = p.i;
      p.i += len;
      if (field === 1) {
        // SentencePiece { string piece = 1; float score = 2; }
        const sub = bytes.subarray(start, start + len);
        const q = { i: 0 };
        let piece = '';
        let score = 0;
        while (q.i < sub.length) {
          const k = varint(sub, q);
          const f = Math.floor(k / 8);
          const w = k & 7;
          if (w === 2) {
            const l = varint(sub, q);
            if (f === 1) piece = new TextDecoder().decode(sub.subarray(q.i, q.i + l));
            q.i += l;
          } else if (w === 5) {
            if (f === 2)
              score = new DataView(sub.buffer, sub.byteOffset + q.i, 4).getFloat32(0, true);
            q.i += 4;
          } else if (w === 0) varint(sub, q);
          else if (w === 1) q.i += 8;
          else break;
        }
        if (piece) vocab.set(piece, score);
      }
    } else if (wire === 0) varint(bytes, p);
    else if (wire === 5) p.i += 4;
    else if (wire === 1) p.i += 8;
    else break;
  }
  pos = p.i;
  return vocab;
}

export function encodeWakePhrase(phrase: string, vocab: Vocab): string[] | null {
  const words = phrase
    .toUpperCase()
    .replace(/[^A-Z' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;
  const out: string[] = [];
  for (const w of words) {
    // Unigram (Viterbi): the split of "▁WORD" whose pieces have the highest total score.
    const text = `▁${w}`;
    const best: { score: number; prev: number }[] = [{ score: 0, prev: -1 }];
    for (let end = 1; end <= text.length; end++) {
      best[end] = { score: -Infinity, prev: -1 };
      for (let start = 0; start < end; start++) {
        const sc = vocab.get(text.slice(start, end));
        if (sc === undefined || best[start].score === -Infinity) continue;
        if (best[start].score + sc > best[end].score)
          best[end] = { score: best[start].score + sc, prev: start };
      }
    }
    if (best[text.length].score === -Infinity) return null; // a letter the model can't spell
    const pieces: string[] = [];
    for (let end = text.length; end > 0; end = best[end].prev)
      pieces.unshift(text.slice(best[end].prev, end));
    out.push(...pieces);
  }
  return out;
}

/** Full keyword-spotter line, e.g. "▁HE Y ▁ SIDE K IC K :2.0 #0.25 @HEY_SIDEKICK". */
export function wakeKeywordLine(phrase: string, vocab: Vocab): string | null {
  const toks = encodeWakePhrase(phrase, vocab);
  if (!toks) return null;
  const label = phrase.toUpperCase().replace(/[^A-Z]+/g, '_');
  return `${toks.join(' ')} :2.0 #0.25 @${label}`;
}

export const DEFAULT_WAKE_PHRASE = 'Hey Sidekick';

const GREETING = /^(?:hey|hi|ok|okay|hello)\s+(.+)$/i;

/** "Hey Sidekick" also wakes on plain "Sidekick" (the greeting is optional). */
export function wakeVariants(phrase: string): string[] {
  const p = phrase.trim().replace(/\s+/g, ' ');
  const m = GREETING.exec(p);
  return m ? [p, m[1]] : [p];
}

/** Keyword-spotter lines for every variant, one per line (the spotter takes several). */
export function wakeKeywordLines(phrase: string, vocab: Vocab): string | null {
  const first = wakeKeywordLine(wakeVariants(phrase)[0], vocab);
  if (!first) return null;
  const rest = wakeVariants(phrase)
    .slice(1)
    .map((v) => wakeKeywordLine(v, vocab))
    .filter((l): l is string => !!l);
  return [first, ...rest].join('\n');
}

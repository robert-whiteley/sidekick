/**
 * Bytes in, text out: the random-access byte source every reader takes (a file on the phone, or
 * bytes in memory in tests), text decoding without TextDecoder, and sizes in words. Pure.
 */

/** A file read in pieces, so a big zip or sheet never has to sit in memory whole. */
export type ByteSource = {
  size: number;
  /** Up to [length] bytes from [offset] (fewer at the end of the file). */
  read(offset: number, length: number): Promise<Uint8Array>;
};

export function memorySource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: async (offset, length) =>
      bytes.subarray(offset, Math.min(bytes.length, offset + Math.max(0, length))),
  };
}

/** A reader stopped because the file (or a part inside it) is bigger than it reads. */
export class TooBig extends Error {
  constructor(what: string) {
    super(`${what} is too big`);
  }
}

/** The whole file, or TooBig past [max] bytes. */
export async function readAll(
  src: ByteSource,
  max: number,
  what = 'The file',
): Promise<Uint8Array> {
  if (src.size > max) throw new TooBig(what);
  return src.read(0, src.size);
}

/** "2.3 MB", "340 KB", "12 bytes". */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} byte${n === 1 ? '' : 's'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

// Windows-1252's 0x80–0x9F (the rest of Latin-1 maps to itself).
const CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

/** One byte as Windows-1252 (old Office files, RTF \'hh, zip names without the UTF-8 flag). */
export const cp1252 = (b: number) =>
  String.fromCharCode(b >= 0x80 && b < 0xa0 ? CP1252[b - 0x80] : b);

function joinCodes(codes: number[], out: string[]) {
  // String.fromCharCode with many arguments at once, in slices the engine accepts.
  for (let i = 0; i < codes.length; i += 8192)
    out.push(String.fromCharCode.apply(null, codes.slice(i, i + 8192)));
}

/** UTF-8, or null when the bytes aren't valid UTF-8 (then they are read as Windows-1252). */
export function utf8(b: Uint8Array, start = 0, end = b.length): string | null {
  const out: string[] = [];
  let codes: number[] = [];
  let i = start;
  while (i < end) {
    const c = b[i];
    let cp: number;
    let n: number;
    if (c < 0x80) {
      cp = c;
      n = 0;
    } else if (c >= 0xc2 && c < 0xe0) {
      cp = c & 0x1f;
      n = 1;
    } else if (c >= 0xe0 && c < 0xf0) {
      cp = c & 0x0f;
      n = 2;
    } else if (c >= 0xf0 && c < 0xf5) {
      cp = c & 0x07;
      n = 3;
    } else return null;
    // Cut mid-character at the end (a capped read): drop the partial character.
    if (i + n > end - 1) {
      for (let k = i + 1; k < end; k++) if ((b[k] & 0xc0) !== 0x80) return null;
      break;
    }
    for (let k = 1; k <= n; k++) {
      const x = b[i + k];
      if ((x & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (x & 0x3f);
    }
    i += n + 1;
    if (cp > 0xffff) {
      cp -= 0x10000;
      codes.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else codes.push(cp);
    if (codes.length >= 65536) {
      joinCodes(codes, out);
      codes = [];
    }
  }
  joinCodes(codes, out);
  return out.join('');
}

function utf16(b: Uint8Array, start: number, little: boolean): string {
  const codes: number[] = [];
  for (let i = start; i + 1 < b.length; i += 2)
    codes.push(little ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const out: string[] = [];
  joinCodes(codes, out);
  return out.join('');
}

function latin(b: Uint8Array): string {
  const out: string[] = [];
  const codes: number[] = [];
  for (let i = 0; i < b.length; i++) codes.push(cp1252(b[i]).charCodeAt(0));
  joinCodes(codes, out);
  return out.join('');
}

/** Text from a file's bytes: UTF-8 or UTF-16 (by byte-order mark), else Windows-1252. */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return utf8(b, 3) ?? latin(b.subarray(3));
  if (b[0] === 0xff && b[1] === 0xfe) return utf16(b, 2, true);
  if (b[0] === 0xfe && b[1] === 0xff) return utf16(b, 2, false);
  return utf8(b) ?? latin(b);
}

/** Looks like a binary file, not text: NUL bytes near the start (UTF-16 has a byte-order mark). */
export function looksBinary(b: Uint8Array): boolean {
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return false;
  const n = Math.min(b.length, 8000);
  for (let i = 0; i < n; i++) if (b[i] === 0) return true;
  return false;
}

export const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
export const u32 = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const i32 = (b: Uint8Array, o: number) =>
  b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

/** A little-endian IEEE double at [o]. */
export function f64(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true);
}

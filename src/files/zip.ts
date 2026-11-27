/**
 * Zip files (and everything built on them: Word, PowerPoint, Excel, OpenDocument, EPUB): the
 * list of files from the central directory at the end, and one file at a time, inflated with
 * fflate (MIT) in pieces up to a cap, so a "zip bomb" or a huge sheet can't fill the phone's
 * memory. Pure (reads through a ByteSource).
 */
import { Inflate } from 'fflate';

import { type ByteSource, cp1252, u16, u32, utf8 } from './bytes';

export type ZipEntry = {
  name: string;
  /** Unpacked size, as the zip says. */
  size: number;
  /** Packed size. */
  packed: number;
  method: number;
  /** Where its local header starts. */
  offset: number;
  encrypted: boolean;
  dir: boolean;
};

export class NotAZip extends Error {}

export const ZIP_LIMITS = { maxEntries: 20_000 };

/** The files in a zip, or NotAZip. */
export async function zipEntries(src: ByteSource): Promise<ZipEntry[]> {
  // End of central directory: 22 bytes, plus a comment of up to 65,535.
  const tailLen = Math.min(src.size, 22 + 65_535);
  const tail = await src.read(src.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new NotAZip('not a zip file');
  let count = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // Zip64: the real numbers are in the zip64 end record the locator points to.
    const loc = eocd - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new NotAZip('damaged zip64 file');
    const recOffset = Number(u32(tail, loc + 8)) + u32(tail, loc + 12) * 2 ** 32;
    const rec = await src.read(recOffset, 56);
    if (u32(rec, 0) !== 0x06064b50) throw new NotAZip('damaged zip64 file');
    count = u32(rec, 32) + u32(rec, 36) * 2 ** 32;
    cdSize = u32(rec, 40) + u32(rec, 44) * 2 ** 32;
    cdOffset = u32(rec, 48) + u32(rec, 52) * 2 ** 32;
  }
  if (cdOffset + cdSize > src.size) throw new NotAZip('damaged zip file');
  const cd = await src.read(cdOffset, cdSize);
  const out: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && n < ZIP_LIMITS.maxEntries && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    let packed = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let offset = u32(cd, p + 42);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
    const name =
      flags & 0x800
        ? (utf8(nameBytes) ?? '')
        : (utf8(nameBytes) ?? Array.from(nameBytes, cp1252).join(''));
    // Zip64 sizes in the extra field, in this order, for the ones that are 0xFFFFFFFF.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = u16(cd, e);
      const len = u16(cd, e + 2);
      if (id === 1) {
        let q = e + 4;
        const big = () => {
          const v = u32(cd, q) + u32(cd, q + 4) * 2 ** 32;
          q += 8;
          return v;
        };
        if (size === 0xffffffff) size = big();
        if (packed === 0xffffffff) packed = big();
        if (offset === 0xffffffff) offset = big();
      }
      e += 4 + len;
    }
    out.push({
      name,
      size,
      packed,
      method,
      offset,
      encrypted: (flags & 1) === 1,
      dir: name.endsWith('/'),
    });
    p = extraEnd + commentLen;
  }
  return out;
}

export class ZipEntryError extends Error {}

/**
 * One file's bytes, at most [cap] of them ([truncated] when there was more). Stored and deflated
 * files only (all Office, OpenDocument and EPUB files use those).
 */
export async function readZipEntry(
  src: ByteSource,
  e: ZipEntry,
  cap: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (e.encrypted) throw new ZipEntryError('password-protected');
  if (e.method !== 0 && e.method !== 8) throw new ZipEntryError('packed in a way I cannot unpack');
  const head = await src.read(e.offset, 30);
  if (u32(head, 0) !== 0x04034b50) throw new ZipEntryError('damaged zip file');
  const start = e.offset + 30 + u16(head, 26) + u16(head, 28);
  if (e.method === 0) {
    const n = Math.min(e.packed, cap);
    return { bytes: await src.read(start, n), truncated: e.packed > cap };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let kept = 0;
  let done = false;
  let failed: unknown = null;
  const inf = new Inflate((chunk, final) => {
    const n = Math.max(0, Math.min(chunk.length, cap - kept));
    if (n) {
      chunks.push(chunk.slice(0, n));
      kept += n;
    }
    total += chunk.length;
    if (final) done = true;
  });
  // Small pieces in: deflate packs at most ~1,000:1, so one piece unpacks to ~16 MB at most.
  const STEP = 16 * 1024;
  for (let o = 0; o < e.packed && total <= cap && !done; o += STEP) {
    const n = Math.min(STEP, e.packed - o);
    const piece = await src.read(start + o, n);
    try {
      inf.push(piece, o + n >= e.packed);
    } catch (err) {
      failed = err;
      break;
    }
  }
  if (failed && !chunks.length) throw new ZipEntryError('damaged zip file');
  const bytes = new Uint8Array(kept);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return { bytes, truncated: total > cap };
}

/** The entry called [name] (case-insensitive, without a leading slash), if there is one. */
export function findEntry(entries: ZipEntry[], name: string): ZipEntry | undefined {
  const n = name.replace(/^\/+/, '').toLowerCase();
  return entries.find((e) => e.name.toLowerCase() === n);
}

/** [target] relative to the folder of [from] ("xl/workbook.xml" + "worksheets/sheet1.xml"). */
export function resolvePath(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * The phone side of the file readers: a file (path, file:// or content:// address) as a
 * ByteSource read in pieces through expo-file-system, so a big zip or spreadsheet is never loaded
 * whole. Everything else is in the pure readers (read.ts).
 */
import { File, FileMode } from 'expo-file-system';

import { currentRegion } from '@/engine/region';
import type { ByteSource } from './bytes';
import { readFile, type FileRead, type ReadOptions } from './read';

const asUri = (path: string) => (/^[a-z]+:\/\//i.test(path) ? path : `file://${path}`);

/** Runs [read] with the file open as a ByteSource; the file is closed afterwards. */
export async function withFileSource<T>(
  path: string,
  read: (src: ByteSource, file: File) => Promise<T>,
): Promise<T> {
  const file = new File(asUri(path));
  const handle = file.open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? file.size ?? 0;
    // One read at a time: the handle has one position.
    let queue: Promise<unknown> = Promise.resolve();
    const src: ByteSource = {
      size,
      read: (offset, length) => {
        const next = queue.then(async () => {
          const n = Math.max(0, Math.min(length, size - offset));
          if (!n) return new Uint8Array(0);
          handle.offset = offset;
          return handle.readBytes(n);
        });
        queue = next.catch(() => {});
        return next;
      },
    };
    return await read(src, file);
  } finally {
    try {
      handle.close();
    } catch {}
  }
}

/** Countries that write dates month first (3/4 is 4 March elsewhere). */
const MONTH_FIRST = new Set(['US', 'PH', 'FM', 'MH', 'PW']);

/** Reads the file at [path] with the right reader for its kind (see read.ts). */
export function readDeviceFile(path: string, name: string, mime?: string): Promise<FileRead> {
  let country: string | null = null;
  try {
    country = currentRegion().country;
  } catch {}
  const opts: ReadOptions = { monthFirst: !!country && MONTH_FIRST.has(country.toUpperCase()) };
  return withFileSource(path, (src) => readFile(src, name, mime, opts));
}

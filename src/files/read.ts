/**
 * One way to read any file Sidekick is given (shared in, attached in the chat, or found in a
 * picked folder): its text, its sheets, or what it is when it can't be read. Pictures,
 * recordings and videos are only recognised here; the chat reads those with the vision model
 * and the speech pipeline. PDFs are read by the phone ([ReadOptions.pdf]).
 *
 * Self-contained (only ./ imports) and pure apart from what is passed in, so other features can
 * reuse it. Tested with made-up files in __tests__/files-*-test.ts.
 */
import {
  type ByteSource,
  decodeText,
  formatBytes,
  looksBinary,
  memorySource,
  TooBig,
} from './bytes';
import { describeOther, extOf, fileType, type FileType, sniffType, TYPE_LABEL } from './kinds';
import { readDocx, readEpub, readOdf, readPptx, OFFICE_LIMITS } from './office';
import { csvSheet, type Sheet, sheetSummary, sheetText } from './sheet';
import { htmlToText, rtfToText, tidy } from './text-formats';
import { readOds, readXlsx } from './workbooks';
import { readXls, XlsError } from './xls';
import { NotAZip, readZipEntry, type ZipEntry, zipEntries, ZipEntryError } from './zip';

export const READ_LIMITS = {
  /** Text files: bytes read (the rest is left out and said so). */
  textBytes: 20_000_000,
  /** CSV/TSV read whole up to this. */
  csvBytes: 60_000_000,
  /** Old Excel files are read whole. */
  xlsBytes: 40_000_000,
  /** Files read from inside a zip, and the unpacked size of each. */
  zipFiles: 30,
  zipFileBytes: 20_000_000,
  /** Characters of text kept from a whole file. */
  maxChars: OFFICE_LIMITS.maxChars,
};

export type FileRead =
  /** Words to read: documents, text, web pages, e-books, a zip's contents. */
  | {
      kind: 'text';
      type: FileType;
      label: string;
      text: string;
      truncated: boolean;
      title?: string;
    }
  /** A spreadsheet: its sheets (for formulas), a summary, and its cells as text. */
  | {
      kind: 'sheet';
      type: FileType;
      label: string;
      sheets: Sheet[];
      summary: string;
      text: string;
      truncated: boolean;
    }
  /** Pictures, recordings, videos and PDFs: read by the phone, not here. */
  | { kind: 'media'; type: 'image' | 'audio' | 'video' | 'pdf'; label: string }
  /** Can't be read (or nothing in it): [text] says what it is and why, plainly. */
  | { kind: 'none'; type: FileType; label: string; text: string };

export type ReadOptions = {
  /** Slashed dates are month first (US) when a column doesn't show which. */
  monthFirst?: boolean;
};

const ZIP_DOCS: FileType[] = ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'epub'];

/** The kind of a zip-based file from what is in it (when its name doesn't say). */
async function zipKind(src: ByteSource, entries: ZipEntry[]): Promise<FileType> {
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  if (names.has('word/document.xml')) return 'docx';
  if (names.has('ppt/presentation.xml')) return 'pptx';
  if (names.has('xl/workbook.xml')) return 'xlsx';
  const m = entries.find((e) => e.name === 'mimetype');
  if (m && m.size < 200) {
    const t = decodeText((await readZipEntry(src, m, 200)).bytes).trim();
    if (t === 'application/epub+zip') return 'epub';
    if (t.endsWith('opendocument.text')) return 'odt';
    if (t.endsWith('opendocument.presentation')) return 'odp';
    if (t.endsWith('opendocument.spreadsheet')) return 'ods';
  }
  return 'zip';
}

const none = (type: FileType, name: string, text: string): FileRead => ({
  kind: 'none',
  type,
  label: TYPE_LABEL[type],
  text,
});

/** Plain reasons for the errors the readers throw. */
function why(e: unknown, name: string, size: number): string {
  const m = e instanceof Error ? e.message : String(e);
  if (e instanceof TooBig)
    return `"${name}" is too big for me to read here (${formatBytes(size)}).`;
  if (/password/i.test(m)) return `"${name}" is password-protected, so I can't read it.`;
  if (e instanceof XlsError || e instanceof ZipEntryError || e instanceof NotAZip)
    return `I couldn't read "${name}": it is ${m}.`;
  return `I couldn't read "${name}": it looks damaged.`;
}

/** Reads [src] (called [name], of type [mime]) into text, sheets, or a plain "what it is". */
export async function readFile(
  src: ByteSource,
  name: string,
  mime?: string,
  opts: ReadOptions = {},
): Promise<FileRead> {
  const head = await src.read(0, Math.min(src.size, 4096));
  let type = fileType(name, mime);
  const sniffed = sniffType(head);
  // The bytes win over a wrong or missing name (a .bin that is a PDF, a .doc that is a zip).
  if (
    sniffed &&
    (type === 'other' ||
      type === 'text' ||
      (sniffed === 'zip' && !ZIP_DOCS.includes(type) && type !== 'zip'))
  )
    type = sniffed;
  if (!src.size) return none(type, name, `"${name}" is empty.`);
  try {
    return await readTyped(src, name, type, head, mime, opts);
  } catch (e) {
    console.log(`[files] ${type} read failed: ${String(e)}`);
    return none(type, name, why(e, name, src.size));
  }
}

async function readTyped(
  src: ByteSource,
  name: string,
  type: FileType,
  head: Uint8Array,
  mime: string | undefined,
  opts: ReadOptions,
): Promise<FileRead> {
  const label = TYPE_LABEL[type];
  switch (type) {
    case 'image':
    case 'audio':
    case 'video':
    case 'pdf':
      return { kind: 'media', type, label };
    case 'text':
    case 'html':
    case 'rtf': {
      if (type === 'text' && looksBinary(head))
        return none('other', name, otherText(head, name, src.size, mime));
      const n = Math.min(src.size, READ_LIMITS.textBytes);
      const raw = decodeText(await src.read(0, n));
      let truncated = src.size > n;
      let title: string | undefined;
      let text: string;
      if (type === 'html') ({ title, text } = htmlToText(raw));
      else if (type === 'rtf') text = rtfToText(raw);
      else text = raw.replace(/\r\n?/g, '\n').trim();
      if (text.length > READ_LIMITS.maxChars) {
        text = text.slice(0, READ_LIMITS.maxChars);
        truncated = true;
      }
      if (!text.trim()) return none(type, name, `I couldn't find any text in "${name}".`);
      return { kind: 'text', type, label, text, truncated, title: title || undefined };
    }
    case 'csv':
    case 'tsv': {
      const n = Math.min(src.size, READ_LIMITS.csvBytes);
      const raw = decodeText(await src.read(0, n));
      const sheet = csvSheet(
        raw,
        name.replace(/\.[^.]+$/, ''),
        opts.monthFirst,
        type === 'tsv' ? '\t' : undefined,
      );
      if (src.size > n) sheet.truncated = true;
      return sheetRead(type, [sheet], name);
    }
    case 'xls': {
      if (src.size > READ_LIMITS.xlsBytes) throw new TooBig('The file');
      const bytes = await src.read(0, src.size);
      return sheetRead(type, readXls(bytes), name);
    }
    case 'docx':
    case 'pptx':
    case 'odt':
    case 'odp':
    case 'xlsx':
    case 'ods':
    case 'epub':
    case 'zip': {
      const entries = await zipEntries(src);
      const kind = type === 'zip' ? await zipKind(src, entries) : type;
      if (kind === 'zip') return readZip(src, entries, name, opts);
      if (kind === 'xlsx') return sheetRead(kind, await readXlsx(src, entries), name);
      if (kind === 'ods') return sheetRead(kind, await readOds(src, entries), name);
      const d =
        kind === 'docx'
          ? await readDocx(src, entries)
          : kind === 'pptx'
            ? await readPptx(src, entries)
            : kind === 'epub'
              ? await readEpub(src, entries)
              : await readOdf(src, entries);
      if (!d.text.trim()) return none(kind, name, `I couldn't find any text in "${name}".`);
      return {
        kind: 'text',
        type: kind,
        label: TYPE_LABEL[kind],
        text: d.text,
        truncated: d.truncated,
        title: d.title,
      };
    }
    default:
      return none('other', name, otherText(head, name, src.size, mime));
  }
}

function otherText(head: Uint8Array, name: string, size: number, mime?: string): string {
  return `"${name}" is ${describeOther(head, name, mime)}, ${formatBytes(size)}. I can't read what's inside this kind of file.`;
}

function sheetRead(type: FileType, sheets: Sheet[], name: string): FileRead {
  const filled = sheets.filter((s) => s.rows.length);
  if (!filled.length) return none(type, name, `"${name}" has no cells with anything in them.`);
  return {
    kind: 'sheet',
    type,
    label: TYPE_LABEL[type],
    sheets: filled,
    summary: sheetSummary(filled),
    text: sheetText(filled, READ_LIMITS.maxChars),
    truncated: filled.some((s) => s.truncated),
  };
}

/** A zip: its list of files, then the text of the readable ones inside (not nested zips). */
async function readZip(
  src: ByteSource,
  entries: ZipEntry[],
  name: string,
  opts: ReadOptions,
): Promise<FileRead> {
  const files = entries.filter(
    (e) =>
      !e.dir && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(e.name) && !/(^|\/)\./.test(e.name),
  );
  const total = files.reduce((n, e) => n + e.size, 0);
  const lines = [
    `Zip "${name}": ${files.length} file${files.length === 1 ? '' : 's'}, ${formatBytes(total)} unpacked.`,
    ...files
      .slice(0, 200)
      .map(
        (e) => `- ${e.name} (${formatBytes(e.size)})${e.encrypted ? ', password-protected' : ''}`,
      ),
  ];
  if (files.length > 200) lines.push(`- …and ${files.length - 200} more`);
  const parts: string[] = [];
  let read = 0;
  let chars = 0;
  let truncated = files.length > 200;
  for (const e of files) {
    const t = fileType(e.name, undefined);
    if (['image', 'audio', 'video', 'pdf', 'zip', 'other'].includes(t)) continue;
    if (read >= READ_LIMITS.zipFiles || chars > READ_LIMITS.maxChars) {
      truncated = true;
      break;
    }
    if (e.encrypted || e.size > READ_LIMITS.zipFileBytes) continue;
    read++;
    try {
      const { bytes } = await readZipEntry(src, e, READ_LIMITS.zipFileBytes);
      const r = await readFile(
        memorySource(bytes),
        e.name.split('/').pop() ?? e.name,
        undefined,
        opts,
      );
      const body = r.kind === 'text' ? r.text : r.kind === 'sheet' ? `${r.summary}\n${r.text}` : '';
      if (!body.trim()) continue;
      const cut = body.slice(0, Math.max(0, READ_LIMITS.maxChars - chars));
      parts.push(`--- ${e.name} ---\n${cut}`);
      chars += cut.length;
      if (r.kind !== 'none' && 'truncated' in r && r.truncated) truncated = true;
    } catch (err) {
      console.log(`[files] zip entry ${extOf(e.name)} failed: ${String(err)}`);
    }
  }
  const text = tidy([lines.join('\n'), ...parts].join('\n\n'));
  return { kind: 'text', type: 'zip', label: 'Zip', text, truncated };
}

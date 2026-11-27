/**
 * Documents that are zips of XML: Word (.docx), PowerPoint (.pptx), OpenDocument text and slides
 * (.odt, .odp) and EPUB e-books. The words in reading order: paragraphs, list items, table rows
 * (cells split by " | "), slide by slide with speaker notes. Pure (reads through a ByteSource).
 */
import { type ByteSource, decodeText } from './bytes';
import { htmlToText, tidy } from './text-formats';
import { attr, local, scanXml } from './xml';
import { findEntry, readZipEntry, resolvePath, type ZipEntry, ZipEntryError } from './zip';

export const OFFICE_LIMITS = {
  /** Unpacked bytes read from one XML part. */
  partBytes: 40_000_000,
  /** Characters kept from a whole document (the chat reads ~190,000 at most). */
  maxChars: 400_000,
  /** E-book chapters / slides read. */
  maxParts: 400,
};

export type DocText = { text: string; truncated: boolean; title?: string; parts?: number };

export async function zipText(
  src: ByteSource,
  e: ZipEntry,
  cap = OFFICE_LIMITS.partBytes,
): Promise<{ text: string; truncated: boolean }> {
  const r = await readZipEntry(src, e, cap);
  return { text: decodeText(r.bytes), truncated: r.truncated };
}

async function part(src: ByteSource, entries: ZipEntry[], name: string) {
  const e = findEntry(entries, name);
  return e ? zipText(src, e) : null;
}

/** Relationship id → target path, from a part's .rels file. */
async function rels(src: ByteSource, entries: ZipEntry[], of: string) {
  const dir = of.split('/').slice(0, -1).join('/');
  const file = `${dir ? `${dir}/` : ''}_rels/${of.split('/').pop()}.rels`;
  const out = new Map<string, { target: string; type: string }>();
  const r = await part(src, entries, file);
  if (!r) return out;
  scanXml(r.text, {
    open: (name, a) => {
      if (local(name) !== 'Relationship') return;
      const id = attr(a, 'Id');
      const target = attr(a, 'Target');
      if (id && target && attr(a, 'TargetMode') !== 'External')
        out.set(id, { target: resolvePath(of, target), type: attr(a, 'Type') ?? '' });
    },
  });
  return out;
}

/** Word's body text: w:t runs, tabs and breaks; table cells with " | "; list items with "- ". */
export function wordXmlText(xml: string): string {
  const out: string[] = [];
  let cellDepth = 0;
  let inText = false;
  let para: string[] = [];
  let listItem = false;
  let deleted = 0;
  scanXml(xml, {
    open: (name, _a, self) => {
      switch (name) {
        case 'w:t':
          if (!self) inText = true;
          break;
        case 'w:tab':
          if (self) para.push('\t');
          break;
        case 'w:br':
        case 'w:cr':
          para.push('\n');
          break;
        case 'w:numPr':
          listItem = true;
          break;
        case 'w:tc':
          cellDepth++;
          break;
        case 'w:del':
          if (!self) deleted++;
          break;
      }
    },
    close: (name) => {
      switch (name) {
        case 'w:t':
          inText = false;
          break;
        case 'w:p': {
          const t = para.join('');
          para = [];
          if (cellDepth > 0) out.push(t, ' ');
          else out.push(listItem && t.trim() ? `- ${t}` : t, '\n');
          listItem = false;
          break;
        }
        case 'w:tc':
          cellDepth--;
          out.push(' | ');
          break;
        case 'w:tr':
          out.push('\n');
          break;
        case 'w:del':
          deleted--;
          break;
      }
    },
    text: (t) => {
      if (inText && deleted === 0) para.push(t);
    },
  });
  return tidy(out.join(''));
}

export async function readDocx(src: ByteSource, entries: ZipEntry[]): Promise<DocText> {
  const main = findEntry(entries, 'word/document.xml');
  if (!main) throw new ZipEntryError('not a Word document');
  const r = await zipText(src, main);
  let text = wordXmlText(r.text);
  // Footnotes and endnotes after the body.
  for (const extra of ['word/footnotes.xml', 'word/endnotes.xml']) {
    const x = await part(src, entries, extra);
    const t = x ? wordXmlText(x.text) : '';
    if (t) text += `\n\nNotes:\n${t}`;
  }
  return cap({ text, truncated: r.truncated });
}

/** DrawingML text (slides, notes): a:t runs, a:p paragraphs, a:br breaks. */
export function drawingText(xml: string): string {
  const out: string[] = [];
  let inText = false;
  scanXml(xml, {
    open: (name, _a, self) => {
      if (name === 'a:t' && !self) inText = true;
      else if (name === 'a:br') out.push('\n');
      else if (name === 'a:tc') out.push(' | ');
    },
    close: (name) => {
      if (name === 'a:t') inText = false;
      else if (name === 'a:p') out.push('\n');
    },
    text: (t) => {
      if (inText) out.push(t);
    },
  });
  return tidy(out.join(''));
}

/** Slides in show order (presentation.xml), each with its speaker notes. */
export async function readPptx(src: ByteSource, entries: ZipEntry[]): Promise<DocText> {
  const pres = 'ppt/presentation.xml';
  const order: string[] = [];
  const p = await part(src, entries, pres);
  if (p) {
    const rel = await rels(src, entries, pres);
    scanXml(p.text, {
      open: (name, a) => {
        if (name !== 'p:sldId') return;
        const id = attr(a, 'r:id');
        const t = id ? rel.get(id)?.target : undefined;
        if (t) order.push(t);
      },
    });
  }
  if (!order.length) {
    const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
    order.push(
      ...entries
        .map((e) => e.name)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
        .sort((a, b) => num(a) - num(b)),
    );
  }
  if (!order.length) throw new ZipEntryError('not a PowerPoint file');
  const out: string[] = [];
  let truncated = false;
  let total = 0;
  let i = 0;
  for (const slide of order.slice(0, OFFICE_LIMITS.maxParts)) {
    i++;
    const s = await part(src, entries, slide);
    if (!s) continue;
    let t = drawingText(s.text);
    const notesTarget = [...(await rels(src, entries, slide)).values()].find((r) =>
      /notesSlide$/.test(r.type),
    )?.target;
    const notes = notesTarget ? await part(src, entries, notesTarget) : null;
    // Notes slides repeat the slide number in a placeholder: keep only real notes.
    const n = notes ? drawingText(notes.text).replace(/^\d+$/m, '').trim() : '';
    if (n) t += `${t ? '\n' : ''}Notes: ${n}`;
    out.push(`Slide ${i}:${t ? `\n${t}` : ' (no text)'}`);
    total += t.length;
    if (total > OFFICE_LIMITS.maxChars) {
      truncated = true;
      break;
    }
  }
  if (order.length > OFFICE_LIMITS.maxParts) truncated = true;
  return cap({ text: out.join('\n\n'), truncated, parts: order.length });
}

/** OpenDocument text (.odt) and slides (.odp): content.xml's paragraphs, tables and pages. */
export function odfXmlText(xml: string): { text: string; pages: number } {
  const out: string[] = [];
  let pages = 0;
  let cellDepth = 0;
  let para: string[] = [];
  let paraDepth = 0;
  let skipDepth = 0;
  let listDepth = 0;
  scanXml(xml, {
    open: (name, a, self) => {
      if (skipDepth) {
        if (!self) skipDepth++;
        return;
      }
      switch (name) {
        case 'text:p':
        case 'text:h':
          if (!self) paraDepth++;
          break;
        case 'text:s': {
          const c = Number(attr(a, 'text:c') ?? 1);
          para.push(' '.repeat(Math.min(Math.max(c, 1), 50)));
          break;
        }
        case 'text:tab':
          para.push('\t');
          break;
        case 'text:line-break':
          para.push('\n');
          break;
        case 'text:list-item':
          if (!self) listDepth++;
          break;
        case 'table:table-cell':
          if (!self) cellDepth++;
          break;
        case 'draw:page':
          pages++;
          out.push(`\n\nSlide ${pages}:\n`);
          break;
        case 'presentation:notes':
          if (!self) out.push('Notes: ');
          break;
        // Annotations (comments) and change-tracking deletions aren't the document's text.
        case 'office:annotation':
        case 'text:tracked-changes':
          if (!self) skipDepth = 1;
          break;
      }
    },
    close: (name) => {
      if (skipDepth) {
        skipDepth--;
        return;
      }
      switch (name) {
        case 'text:p':
        case 'text:h': {
          paraDepth--;
          if (paraDepth > 0) break;
          const t = para.join('');
          para = [];
          if (cellDepth > 0) out.push(t, ' ');
          else out.push(listDepth > 0 && t.trim() ? `- ${t}` : t, '\n');
          break;
        }
        case 'text:list-item':
          listDepth--;
          break;
        case 'table:table-cell':
          cellDepth--;
          out.push(' | ');
          break;
        case 'table:table-row':
          out.push('\n');
          break;
      }
    },
    text: (t) => {
      if (!skipDepth && paraDepth > 0) para.push(t);
    },
  });
  return { text: tidy(out.join('')), pages };
}

export async function readOdf(src: ByteSource, entries: ZipEntry[]): Promise<DocText> {
  const c = await part(src, entries, 'content.xml');
  if (!c) throw new ZipEntryError('not an OpenDocument file');
  const r = odfXmlText(c.text);
  return cap({ text: r.text, truncated: c.truncated, parts: r.pages || undefined });
}

/** An e-book's chapters in reading order (the OPF spine), as text. */
export async function readEpub(src: ByteSource, entries: ZipEntry[]): Promise<DocText> {
  const container = await part(src, entries, 'META-INF/container.xml');
  let opfPath = '';
  if (container)
    scanXml(container.text, {
      open: (name, a) => {
        if (!opfPath && local(name) === 'rootfile') opfPath = attr(a, 'full-path') ?? '';
      },
    });
  if (!opfPath) opfPath = entries.find((e) => /\.opf$/i.test(e.name))?.name ?? '';
  const opf = opfPath ? await part(src, entries, opfPath) : null;
  if (!opf) throw new ZipEntryError('not an e-book');
  const manifest = new Map<string, string>();
  const spine: string[] = [];
  let title = '';
  let inTitle = false;
  scanXml(opf.text, {
    open: (name, a, self) => {
      const l = local(name);
      if (l === 'item') {
        const id = attr(a, 'id');
        const href = attr(a, 'href');
        if (id && href) manifest.set(id, resolvePath(opfPath, decodeURIComponent(href)));
      } else if (l === 'itemref') {
        const id = attr(a, 'idref');
        if (id && attr(a, 'linear') !== 'no') spine.push(id);
      } else if (name === 'dc:title' && !self && !title) inTitle = true;
    },
    close: (name) => {
      if (name === 'dc:title') inTitle = false;
    },
    text: (t) => {
      if (inTitle) title += t;
    },
  });
  const out: string[] = [];
  let total = 0;
  let truncated = false;
  for (const id of spine.slice(0, OFFICE_LIMITS.maxParts)) {
    const href = manifest.get(id);
    const ch = href ? await part(src, entries, href) : null;
    if (!ch) continue;
    const t = htmlToText(ch.text).text;
    if (!t) continue;
    out.push(t);
    total += t.length;
    if (total > OFFICE_LIMITS.maxChars) {
      truncated = true;
      break;
    }
  }
  if (spine.length > OFFICE_LIMITS.maxParts) truncated = true;
  return cap({ text: out.join('\n\n'), truncated, title: title.trim() || undefined });
}

function cap(d: DocText): DocText {
  if (d.text.length <= OFFICE_LIMITS.maxChars) return d;
  return { ...d, text: d.text.slice(0, OFFICE_LIMITS.maxChars), truncated: true };
}

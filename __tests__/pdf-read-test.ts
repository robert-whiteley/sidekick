import { readPdfPages, type PdfPages } from '../src/memory/pdf-read';
import {
  cleanPageText,
  fileItems,
  indexableKind,
  isIndexableFile,
  pageNeedsOcr,
  PDF_LIMITS,
  pdfPagesToRead,
  pdfText,
  pdfUnchanged,
  pdfVer,
} from '../src/memory/sources-logic';

const prose = (n: number) => `Page ${n} has plenty of embedded words to search through.`;

/** A fake PDF: null pages are scans (no embedded text). */
function fake(pages: (string | null)[], ocr: boolean) {
  const calls = { text: [] as number[], ocr: [] as number[] };
  const pdf: PdfPages = {
    pageText: async (i) => {
      calls.text.push(i);
      return { pages: pages.length, text: pages[i] ?? '' };
    },
    pageOcr: ocr
      ? async (i) => {
          calls.ocr.push(i);
          return [`SCANNED PAGE ${i}`, 'Invoice total 42.00 GBP'];
        }
      : null,
  };
  return { pdf, calls };
}

describe('PDF files', () => {
  it('takes PDFs only where the phone can read them, with their own size cap', () => {
    expect(isIndexableFile('report.pdf', 100)).toBe(false);
    expect(indexableKind('report.PDF', 5_000_000, true)).toBe('pdf');
    expect(indexableKind('notes.md', 100, true)).toBe('text');
    expect(indexableKind('huge.pdf', PDF_LIMITS.maxBytes + 1, true)).toBeNull();
    expect(indexableKind('.hidden.pdf', 100, true)).toBeNull();
    expect(indexableKind('photo.jpg', 100, true)).toBeNull();
  });

  it('caps pages at 30', () => {
    expect(pdfPagesToRead(0)).toBe(0);
    expect(pdfPagesToRead(3)).toBe(3);
    expect(pdfPagesToRead(400)).toBe(30);
  });

  it('treats pages with next to no text as scans', () => {
    expect(pageNeedsOcr(null)).toBe(true);
    expect(pageNeedsOcr('')).toBe(true);
    expect(pageNeedsOcr('  12  ')).toBe(true);
    expect(pageNeedsOcr(prose(1))).toBe(false);
  });

  it('tidies page text and joins pages with blank lines', () => {
    expect(cleanPageText('  a \t b \r\n\r\n\r\n\n c  ')).toBe('a b\n\nc');
    expect(pdfText(['one', null, '  ', 'two'])).toBe('one\n\ntwo');
  });

  it('reads embedded text and OCRs only the scanned pages, one page at a time', async () => {
    const { pdf, calls } = fake([prose(1), null, prose(3)], true);
    const r = await readPdfPages(pdf);
    expect(calls.text).toEqual([0, 1, 2]);
    expect(calls.ocr).toEqual([1]);
    expect(r.ocrPages).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.text).toBe(`${prose(1)}\n\nSCANNED PAGE 1\nInvoice total 42.00 GBP\n\n${prose(3)}`);
  });

  it('reads no more than 30 pages', async () => {
    const { pdf, calls } = fake(
      Array.from({ length: 45 }, () => null),
      true,
    );
    const r = await readPdfPages(pdf);
    expect(calls.ocr.length).toBe(30);
    expect(Math.max(...calls.text)).toBe(29);
    expect(r.ocrPages).toBe(30);
  });

  it('marks a PDF incomplete when scans need OCR that is not downloaded', async () => {
    const { pdf } = fake([prose(1), null], false);
    const r = await readPdfPages(pdf);
    expect(r.complete).toBe(false);
    expect(r.text).toBe(prose(1));
  });

  it('handles an empty PDF', async () => {
    const r = await readPdfPages(fake([], true).pdf);
    expect(r).toEqual({ text: '', ocrPages: 0, complete: true });
  });

  it('re-reads a PDF when it changes, or when OCR arrives for one read without it', () => {
    expect(pdfUnchanged([], 5, true)).toBe(false);
    expect(pdfUnchanged([pdfVer(5, true)], 5, true)).toBe(true);
    expect(pdfUnchanged([pdfVer(5, true)], 6, true)).toBe(false);
    expect(pdfUnchanged([pdfVer(5, false)], 5, false)).toBe(true);
    expect(pdfUnchanged([pdfVer(5, false)], 5, true)).toBe(false);
  });

  it('chunks PDF text into file passages with the PDF version and a larger cap', () => {
    const page = `${'word '.repeat(230).trim()}.`;
    const text = pdfText(
      Array.from({ length: 30 }, () => `${page}\n\n${page}\n\n${page}\n\n${page}`),
    );
    const items = fileItems(
      'content://t/A',
      'content://t/A/d/1',
      'A/x.pdf',
      7,
      text,
      pdfVer(7, false),
      PDF_LIMITS.maxChunks,
    );
    expect(items.length).toBe(PDF_LIMITS.maxChunks);
    expect(items[0].ver).toBe('7:no-ocr');
    expect(items[0].text.startsWith('File A/x.pdf:\n')).toBe(true);
    expect(items[1].text.startsWith('File A/x.pdf (part 2):\n')).toBe(true);
  });
});

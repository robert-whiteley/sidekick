import { cleanPageText, pageNeedsOcr, pdfPagesToRead, pdfText } from './sources-logic';

/** The phone side of reading one PDF, one page per call (native module in the app, fakes in tests). */
export type PdfPages = {
  /** Page count and the page's embedded text (null when the phone can't read PDF text). */
  pageText(index: number): Promise<{ pages: number; text: string | null }>;
  /** OCR lines of the rendered page; null when OCR isn't available. */
  pageOcr: ((index: number) => Promise<string[]>) | null;
};

export type PdfRead = {
  text: string;
  /** Pages run through OCR. */
  ocrPages: number;
  /** False when a scanned page was left unread because OCR is missing. */
  complete: boolean;
};

/**
 * A PDF's text, a page at a time: the embedded text where a page has some, else OCR of the
 * rendered page. First [PDF_LIMITS.maxPages] pages only.
 */
export async function readPdfPages(pdf: PdfPages): Promise<PdfRead> {
  const first = await pdf.pageText(0);
  const count = pdfPagesToRead(first.pages);
  const pages: string[] = [];
  let ocrPages = 0;
  let complete = true;
  for (let i = 0; i < count; i++) {
    const embedded = i === 0 ? first.text : (await pdf.pageText(i)).text;
    if (!pageNeedsOcr(embedded)) {
      pages.push(embedded ?? '');
      continue;
    }
    if (!pdf.pageOcr) {
      complete = false;
      pages.push(embedded ?? '');
      continue;
    }
    ocrPages++;
    const ocr = cleanPageText((await pdf.pageOcr(i)).join('\n'));
    // Keep whichever has more: a page with a few embedded words over a photo of text.
    pages.push(ocr.length >= (embedded?.trim().length ?? 0) ? ocr : (embedded ?? ''));
  }
  return { text: pdfText(pages), ocrPages, complete };
}

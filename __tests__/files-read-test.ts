/**
 * The file reader (src/files) with made-up files: text in several encodings, web pages, RTF,
 * Word, PowerPoint, OpenDocument, EPUB, Excel, CSV, zips, and files it can't read.
 */
import { strToU8, zipSync } from 'fflate';

import { decodeText, memorySource } from '@/files/bytes';
import { fileType, sniffType } from '@/files/kinds';
import { readFile, type FileRead } from '@/files/read';
import { formatValue, XDate } from '@/files/sheet';
import { readZipEntry, zipEntries } from '@/files/zip';

const read = (bytes: Uint8Array, name: string, mime?: string) =>
  readFile(memorySource(bytes), name, mime);
const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]),
    ),
  );
const textOf = (r: FileRead) => {
  if (r.kind === 'text' || r.kind === 'none') return r.text;
  if (r.kind === 'sheet') return r.text;
  return '';
};

describe('text', () => {
  test('UTF-8, UTF-16 and Windows-1252', () => {
    expect(decodeText(strToU8('Café ☕'))).toBe('Café ☕');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x48, 0, 0x69, 0]))).toBe('Hi');
    expect(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x80, 0x21]))).toBe('Café€!');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });

  test('a text file, a JSON file, and a binary file called .txt', async () => {
    const r = await read(strToU8('Shopping:\r\n- milk\r\n- eggs\r\n'), 'list.txt');
    expect(r).toMatchObject({ kind: 'text', type: 'text', text: 'Shopping:\n- milk\n- eggs' });
    expect((await read(strToU8('{"a":1}'), 'x.json')).kind).toBe('text');
    const bin = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 0, 0, 1]);
    const r2 = await read(bin, 'notes.txt');
    expect(r2.kind).toBe('none');
    expect(textOf(r2)).toMatch(/7z archive, 10 bytes/);
  });

  test('a web page keeps its words, not its scripts', async () => {
    const html = `<html><head><title>Trip &amp; plan</title><style>p{}</style></head><body>
      <h1>Day 1</h1><p>Fly to <b>Lisbon</b>&nbsp;at 9.</p><script>alert(1)</script>
      <ul><li>Passport</li><li>Charger</li></ul><table><tr><td>Hotel</td><td>€120</td></tr></table></body></html>`;
    const r = await read(strToU8(html), 'trip.html');
    expect(r).toMatchObject({ kind: 'text', type: 'html', title: 'Trip & plan' });
    expect(textOf(r)).toBe('Day 1\nFly to Lisbon at 9.\n- Passport\n- Charger\nHotel | €120');
  });

  test('RTF', async () => {
    const rtf =
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}\\f0 Dear Sam,\\par Caf\\'e9 at 10\\u8364?.\\par{\\*\\generator Word;}Thanks\\tab Jo}";
    const r = await read(strToU8(rtf), 'letter.rtf');
    expect(textOf(r)).toBe('Dear Sam,\nCafé at 10€.\nThanks Jo');
  });
});

describe('office documents', () => {
  test('Word: paragraphs, a list, a table, a deletion, footnotes', async () => {
    const doc = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
      <w:p><w:r><w:t>Minutes</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t xml:space="preserve">Buy </w:t></w:r><w:r><w:t>paint</w:t></w:r></w:p>
      <w:p><w:del><w:r><w:t>removed</w:t></w:r></w:del><w:r><w:t>Kept</w:t><w:tab/><w:t>here</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Job</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Ana</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Paint</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`;
    const notes =
      '<w:footnotes><w:footnote><w:p><w:r><w:t>See page 2.</w:t></w:r></w:p></w:footnote></w:footnotes>';
    const r = await read(
      zip({ 'word/document.xml': doc, 'word/footnotes.xml': notes }),
      'Minutes.docx',
    );
    expect(r).toMatchObject({ kind: 'text', type: 'docx', label: 'Word document' });
    expect(textOf(r)).toBe(
      'Minutes\n- Buy paint\nKept here\nName | Job\nAna | Paint\n\nNotes:\nSee page 2.',
    );
  });

  test('PowerPoint: slides in show order, with speaker notes', async () => {
    const slide = (t: string) =>
      `<p:sld><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sld>`;
    const files = {
      'ppt/presentation.xml':
        '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="rId3"/><p:sldId id="2" r:id="rId2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml" Type="x/slide"/><Relationship Id="rId3" Target="slides/slide2.xml" Type="x/slide"/></Relationships>',
      'ppt/slides/slide1.xml': slide('Budget'),
      'ppt/slides/slide2.xml': slide('Welcome'),
      'ppt/slides/_rels/slide2.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide1.xml" Type="http://x/notesSlide"/></Relationships>',
      'ppt/notesSlides/notesSlide1.xml':
        '<p:notes><a:p><a:r><a:t>Say hello</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>',
    };
    const r = await read(zip(files), 'deck.pptx');
    expect(textOf(r)).toBe('Slide 1:\nWelcome\nNotes: Say hello\n\nSlide 2:\nBudget');
  });

  test('OpenDocument text and slides', async () => {
    const odt = `<office:document-content><office:body><office:text>
      <text:h>Plan</text:h><text:p>Two<text:s text:c="2"/>spaces<text:tab/>tab</text:p>
      <text:list><text:list-item><text:p>First</text:p></text:list-item></text:list>
      <text:p>Body<office:annotation><text:p>a comment</text:p></office:annotation> end</text:p>
      </office:text></office:body></office:document-content>`;
    const r = await read(
      zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': odt }),
      'plan',
    );
    expect(r).toMatchObject({ kind: 'text', type: 'odt' });
    expect(textOf(r)).toBe('Plan\nTwo spaces tab\n- First\nBody end');
    const odp = `<office:presentation><draw:page><draw:frame><text:p>Hello</text:p></draw:frame>
      <presentation:notes><text:p>notes here</text:p></presentation:notes></draw:page><draw:page><text:p>Bye</text:p></draw:page></office:presentation>`;
    const p = await read(zip({ 'content.xml': odp }), 'talk.odp');
    expect(textOf(p)).toBe('Slide 1:\nHello\nNotes: notes here\n\nSlide 2:\nBye');
  });

  test('EPUB: chapters in spine order, with the title', async () => {
    const files = {
      mimetype: 'application/epub+zip',
      'META-INF/container.xml':
        '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>',
      'OEBPS/book.opf': `<package><metadata><dc:title>Sea Tales</dc:title></metadata><manifest>
        <item id="c1" href="text/one.xhtml"/><item id="c2" href="text/two%20b.xhtml"/></manifest>
        <spine><itemref idref="c2"/><itemref idref="c1"/></spine></package>`,
      'OEBPS/text/one.xhtml': '<html><body><p>The end.</p></body></html>',
      'OEBPS/text/two b.xhtml':
        '<html><body><h1>Chapter 1</h1><p>It was a dark night.</p></body></html>',
    };
    const r = await read(zip(files), 'tales.epub');
    expect(r).toMatchObject({ kind: 'text', type: 'epub', title: 'Sea Tales' });
    expect(textOf(r)).toBe('Chapter 1\nIt was a dark night.\n\nThe end.');
  });
});

describe('spreadsheets', () => {
  const xlsx = () =>
    zip({
      'xl/workbook.xml':
        '<workbook><workbookPr/><sheets><sheet name="Invoices" sheetId="1" r:id="rId1"/><sheet name="Hidden" state="hidden" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
      'xl/sharedStrings.xml':
        '<sst><si><t>Date</t></si><si><t>Customer</t></si><si><t>Amount</t></si><si><r><t>Ac</t></r><r><t>me</t></r><rPh><t>x</t></rPh></si><si><t>Paid</t></si></sst>',
      'xl/styles.xml':
        '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>4</v></c></row>
        <row r="2"><c r="A2" s="1"><v>46025</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>10.5</v></c><c r="D2" t="b"><v>1</v></c></row>
        <row r="3"><c r="A3" s="2"><v>46056</v></c><c r="B3" t="inlineStr"><is><t>Bob</t></is></c><c r="C3"><f>C2*2</f><v>21</v></c><c r="D3" t="b"><v>0</v></c></row>
        <row r="4"><c r="C4"><f>SUM(C2:C3)</f></c><c r="E4" t="e"><v>#DIV/0!</v></c></row>
        </sheetData></worksheet>`,
      'xl/worksheets/sheet2.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>secret</v></c></row></sheetData></worksheet>',
    });

  test('Excel: shared and inline text, dates by format, saved formula results, errors', async () => {
    const r = await read(xlsx(), 'books.xlsx');
    if (r.kind !== 'sheet') throw new Error(r.kind);
    const [s, hidden] = r.sheets;
    expect(s.name).toBe('Invoices');
    expect(s.rows[0]).toEqual(['Date', 'Customer', 'Amount', 'Paid']);
    expect(s.rows[1][0]).toBeInstanceOf(XDate);
    expect(formatValue(s.rows[1][0])).toBe('3 Jan 2026');
    expect(s.rows[1].slice(1)).toEqual(['Acme', 10.5, true]);
    expect(s.rows[2].slice(1)).toEqual(['Bob', 21, false]);
    expect(formatValue(s.rows[3][4])).toBe('#DIV/0!');
    expect(s).toMatchObject({ formulas: 2, uncached: 1 });
    expect(hidden).toMatchObject({ name: 'Hidden', hidden: true, rows: [['secret']] });
    expect(r.summary).toContain(
      'Sheet "Invoices": 3 rows, 5 columns (header in row 1, data in rows 2–4).',
    );
    expect(r.summary).toContain('- A (Date): dates, 3 Jan 2026 to 3 Feb 2026');
    expect(r.summary).toContain('- C (Amount): numbers, 10.5 to 21');
    expect(r.summary).toContain('2 cells have formulas (1 with no saved result).');
    expect(r.text).toContain('Row 2: 3 Jan 2026 | Acme | 10.5 | TRUE');
  });

  test('OpenDocument spreadsheet: typed cells, repeats, a huge empty tail', async () => {
    const content = `<office:spreadsheet><table:table table:name="Food">
      <table:table-row><table:table-cell office:value-type="string"><text:p>Item</text:p></table:table-cell><table:table-cell><text:p>Cost</text:p></table:table-cell></table:table-row>
      <table:table-row table:number-rows-repeated="2"><table:table-cell office:value-type="string"><text:p>Tea</text:p></table:table-cell><table:table-cell office:value-type="currency" office:value="2.5" table:formula="of:=1+1.5"><text:p>£2.50</text:p></table:table-cell></table:table-row>
      <table:table-row><table:table-cell office:value-type="date" office:date-value="2026-03-01"/><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
      <table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="16384"/></table:table-row>
      </table:table></office:spreadsheet>`;
    const r = await read(
      zip({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet', 'content.xml': content }),
      'food.ods',
    );
    if (r.kind !== 'sheet') throw new Error(r.kind);
    const s = r.sheets[0];
    expect(s.rows.length).toBe(4);
    expect(s.rows[1]).toEqual(['Tea', 2.5]);
    expect(s.rows[2]).toEqual(['Tea', 2.5]);
    expect(formatValue(s.rows[3][0])).toBe('1 Mar 2026');
    expect(s.formulas).toBe(2);
  });

  test('CSV: separators, quotes, money, percents, leading zeros, day-first dates', async () => {
    const csv =
      'Name;Amount;Share;Code;When\n"Smith; J";1.234,50;12%;007;03/02/2026\nLee;-3,5;;12;25/12/2026\n';
    const r = await read(strToU8(csv), 'money.csv');
    if (r.kind !== 'sheet') throw new Error(r.kind);
    const [, a, b] = r.sheets[0].rows;
    expect(a.slice(0, 4)).toEqual(['Smith; J', 1234.5, 0.12, '007']);
    expect(formatValue(a[4])).toBe('3 Feb 2026');
    expect(b.slice(0, 2)).toEqual(['Lee', -3.5]);
    const us = await readFile(
      memorySource(strToU8('d,n\n03/02/2026,"$1,200"\n')),
      'us.csv',
      undefined,
      { monthFirst: true },
    );
    if (us.kind !== 'sheet') throw new Error(us.kind);
    expect(formatValue(us.sheets[0].rows[1][0])).toBe('2 Mar 2026');
    expect(us.sheets[0].rows[1][1]).toBe(1200);
    const tsv = await read(strToU8('a\tb\n1\t2\n'), 'x.tsv');
    expect(tsv.kind === 'sheet' && tsv.sheets[0].rows[1]).toEqual([1, 2]);
  });
});

describe('zips and other files', () => {
  test('a zip lists its files and reads the readable ones inside', async () => {
    const inner = zip({
      'word/document.xml':
        '<w:document><w:body><w:p><w:r><w:t>Inner doc</w:t></w:r></w:p></w:body></w:document>',
    });
    const z = zip({
      'notes/a.txt': 'Hello from a',
      'b.csv': 'x,y\n1,2\n',
      'c.docx': inner,
      'photo.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2]),
      '__MACOSX/._a.txt': 'junk',
    });
    const r = await read(z, 'stuff.zip');
    expect(r.kind).toBe('text');
    const t = textOf(r);
    expect(t).toMatch(/^Zip "stuff.zip": 4 files/);
    expect(t).toContain('- photo.jpg (6 bytes)');
    expect(t).toContain('--- notes/a.txt ---\nHello from a');
    expect(t).toContain('--- c.docx ---\nInner doc');
    expect(t).toContain('--- b.csv ---\nSheet "b": 1 row');
    expect(t).not.toContain('junk');
  });

  test('an unpacked size is capped (a zip bomb cannot fill memory)', async () => {
    const big = zip({ 'zeros.txt': new Uint8Array(5_000_000) });
    const src = memorySource(big);
    const [e] = await zipEntries(src);
    const r = await readZipEntry(src, e, 1000);
    expect(r.bytes.length).toBe(1000);
    expect(r.truncated).toBe(true);
  });

  test('types from names, MIME types and first bytes', () => {
    expect(fileType('a.XLSX', undefined)).toBe('xlsx');
    expect(fileType('scan', 'application/pdf')).toBe('pdf');
    expect(fileType('clip', 'video/mp4')).toBe('video');
    expect(fileType('memo.m4a', 'application/octet-stream')).toBe('audio');
    expect(sniffType(strToU8('%PDF-1.7'))).toBe('pdf');
    const mp4 = new Uint8Array([0, 0, 0, 0x18, ...strToU8('ftypisom')]);
    expect(sniffType(mp4)).toBe('video');
  });

  test('pictures, recordings, videos and PDFs go to the phone readers', async () => {
    expect(await read(strToU8('%PDF-1.4 ...'), 'download.bin')).toMatchObject({
      kind: 'media',
      type: 'pdf',
    });
    expect(await read(new Uint8Array([0xff, 0xd8, 0xff, 1]), 'IMG_1.jpg')).toMatchObject({
      kind: 'media',
      type: 'image',
    });
    expect(await read(strToU8('ID3....'), 'song.mp3')).toMatchObject({
      kind: 'media',
      type: 'audio',
    });
  });

  test('unknown, empty and damaged files say plainly what they are', async () => {
    const model = await read(
      strToU8('solid cube\nfacet normal 0 0 1\n'.repeat(1) + '\0'),
      'cube.stl',
    );
    expect(textOf(model)).toMatch(
      /^"cube.stl" is a 3D model, \d+ bytes\. I can't read what's inside/,
    );
    expect(textOf(await read(new Uint8Array(0), 'empty.txt'))).toBe('"empty.txt" is empty.');
    expect(textOf(await read(strToU8('PK\x03\x04garbage'), 'broken.docx'))).toMatch(
      /I couldn't read "broken.docx"/,
    );
    const doc = await read(
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      'old.doc',
    );
    expect(textOf(doc)).toContain('an old Word document (.doc; save it as .docx');
  });
});

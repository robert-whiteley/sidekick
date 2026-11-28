/** A changed spreadsheet saved as Excel: read back by the app's own reader, every sheet kept. */
import { memorySource } from '@/files/bytes';
import { readFile } from '@/files/read';
import { type Sheet, XDate, XErr } from '@/files/sheet';
import { sheetNames, toXlsx } from '@/files/xlsx-write';
import { sheetSaveAs } from '@/engine/shared-doc-logic';

const sheet = (name: string, rows: Sheet['rows'], hidden?: boolean): Sheet => ({
  name,
  rows,
  truncated: false,
  formulas: 0,
  uncached: 0,
  hidden,
});

test('an Excel, OpenDocument or old Excel sheet is saved as Excel; a CSV or pasted table as CSV', () => {
  expect(sheetSaveAs('xlsx').ext).toBe('xlsx');
  expect(sheetSaveAs('ods').ext).toBe('xlsx');
  expect(sheetSaveAs('xls').ext).toBe('xlsx');
  expect(sheetSaveAs('csv').ext).toBe('csv');
  expect(sheetSaveAs(undefined).ext).toBe('csv');
});

test('the saved workbook reads back with every sheet, value type and the new column', async () => {
  const bytes = toXlsx([
    sheet('Sales', [
      ['Item', 'Price', 'Date', 'Paid', 'VAT (new)'],
      ['Tea & <biscuits>', 4.5, new XDate(46000), true, 0.9],
      ['Coffee', 3, new XDate(46001.5), false, new XErr('#DIV/0!')],
    ]),
    sheet('Notes', [['kept']]),
  ]);
  const r = await readFile(memorySource(bytes), 'shop (changed).xlsx');
  if (r.kind !== 'sheet') throw new Error(`read as ${r.kind}`);
  expect(r.type).toBe('xlsx');
  expect(r.sheets.map((s) => s.name)).toEqual(['Sales', 'Notes']);
  const [head, tea, coffee] = r.sheets[0].rows;
  expect(head).toEqual(['Item', 'Price', 'Date', 'Paid', 'VAT (new)']);
  expect(tea[0]).toBe('Tea & <biscuits>');
  expect(tea[1]).toBe(4.5);
  expect(tea[2]).toBeInstanceOf(XDate);
  expect((tea[2] as XDate).serial).toBe(46000);
  expect(tea[3]).toBe(true);
  expect(tea[4]).toBe(0.9);
  expect((coffee[2] as XDate).serial).toBe(46001.5);
  expect(coffee[4]).toBeInstanceOf(XErr);
  expect(r.sheets[1].rows).toEqual([['kept']]);
});

test("sheet names follow Excel's rules", () => {
  expect(sheetNames(['a/b', 'A/B', '', 'x'.repeat(40)])).toEqual([
    'a b',
    'A B 2',
    'Sheet3',
    'x'.repeat(31),
  ]);
});

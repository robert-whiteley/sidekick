/**
 * Old Excel (.xls): a made-up workbook built here byte by byte (a compound file holding a BIFF8
 * Workbook stream), read back by src/files/xls.ts.
 */
import { memorySource } from '@/files/bytes';
import { readFile } from '@/files/read';
import { formatValue, XDate } from '@/files/sheet';
import { readXls } from '@/files/xls';

const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const f64 = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n, true);
  return [...b];
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const rec = (type: number, data: number[]) => [...le16(type), ...le16(data.length), ...data];
const xlString = (s: string) => [...le16(s.length), 0, ...ascii(s)];

function workbookStream(): number[] {
  const bof = (dt: number) => rec(0x0809, [...le16(0x0600), ...le16(dt), ...new Array(12).fill(0)]);
  const xf = (fmt: number) => rec(0x00e0, [...le16(0), ...le16(fmt), ...new Array(16).fill(0)]);
  // SST: "Name", then "Customer" split across a CONTINUE record that switches to UTF-16.
  const sst = rec(0x00fc, [
    ...le32(3),
    ...le32(3),
    ...le16(4),
    0,
    ...ascii('Name'),
    ...le16(8),
    0,
    ...ascii('Cust'),
  ]);
  const cont = rec(0x003c, [
    1,
    ...[...'omer'].flatMap((c) => le16(c.charCodeAt(0))),
    ...le16(3),
    0,
    ...ascii('Ann'),
  ]);
  const head = [
    ...bof(5),
    ...rec(0x041e, [...le16(164), ...xlString('dd/mm/yyyy')]),
    ...xf(0),
    ...xf(164),
  ];
  const boundLen = 4 + 6 + 2 + 5; // record header + pos/flags + short string "Sales"
  const tail = [...sst, ...cont, ...rec(0x000a, [])];
  const sheetPos = head.length + boundLen + tail.length;
  const bound = rec(0x0085, [...le32(sheetPos), 0, 0, 5, 0, ...ascii('Sales')]);
  const cell = (r: number, c: number, xf: number) => [...le16(r), ...le16(c), ...le16(xf)];
  const sheet = [
    ...bof(0x10),
    ...rec(0x00fd, [...cell(0, 0, 0), ...le32(0)]), // Name
    ...rec(0x00fd, [...cell(0, 1, 0), ...le32(1)]), // Customer
    ...rec(0x0204, [...cell(0, 2, 0), ...xlString('Total')]),
    ...rec(0x0204, [...cell(0, 3, 0), ...xlString('When')]),
    ...rec(0x00fd, [...cell(1, 0, 0), ...le32(2)]), // Ann
    ...rec(0x0203, [...cell(1, 1, 0), ...f64(12.75)]),
    // RK: integer 40 (value << 2 | 2), and 1234 / 100.
    ...rec(0x027e, [...cell(1, 2, 0), ...le32((40 << 2) | 2)]),
    ...rec(0x027e, [...cell(1, 3, 1), ...le32((46025 << 2) | 2)]),
    ...rec(0x00bd, [
      ...le16(2),
      ...le16(1),
      ...le16(0),
      ...le32((1234 << 2) | 3),
      ...le16(0),
      ...le32((-5 << 2) | 2),
      ...le16(2),
    ]),
    // A formula with a saved number, and one with a saved text (in the STRING record after it).
    ...rec(0x0006, [...cell(3, 1, 0), ...f64(52.75), 0, 0, 0, 0, 0, 0]),
    ...rec(0x0006, [...cell(3, 2, 0), 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]),
    ...rec(0x0207, xlString('done')),
    ...rec(0x0205, [...cell(3, 3, 0), 1, 0]),
    ...rec(0x000a, []),
  ];
  return [...head, ...bound, ...tail, ...sheet];
}

/** A compound file with one stream, "Workbook" (512-byte sectors: FAT, directory, data). */
function compoundFile(stream: number[]): Uint8Array {
  const data = [...stream];
  while (data.length < 4096 || data.length % 512) data.push(0);
  const nData = data.length / 512;
  const out = new Uint8Array(512 * (3 + nData));
  const hdr = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  out.set(hdr, 0);
  out.set(le16(0x3e), 0x18);
  out.set(le16(3), 0x1a);
  out.set(le16(0xfffe), 0x1c);
  out.set(le16(9), 0x1e);
  out.set(le16(6), 0x20);
  out.set(le32(1), 0x2c);
  out.set(le32(1), 0x30);
  out.set(le32(0), 0x38); // no mini stream: every stream in regular sectors
  out.set(le32(0xfffffffe), 0x3c);
  out.set(le32(0xfffffffe), 0x44);
  for (let i = 0; i < 109; i++) out.set(le32(i === 0 ? 0 : 0xffffffff), 0x4c + i * 4);
  // FAT (sector 0): itself, the directory, then the data chain.
  const fat = 512;
  for (let i = 0; i < 128; i++) out.set(le32(0xffffffff), fat + i * 4);
  out.set(le32(0xfffffffd), fat);
  out.set(le32(0xfffffffe), fat + 4);
  for (let i = 0; i < nData; i++)
    out.set(le32(i === nData - 1 ? 0xfffffffe : 3 + i), fat + (2 + i) * 4);
  // Directory (sector 1): the root and "Workbook".
  const dir = 1024;
  const entry = (o: number, name: string, type: number, start: number, size: number) => {
    [...name].forEach((c, i) => out.set(le16(c.charCodeAt(0)), o + i * 2));
    out.set(le16((name.length + 1) * 2), o + 0x40);
    out[o + 0x42] = type;
    out.set(le32(start), o + 0x74);
    out.set(le32(size), o + 0x78);
  };
  entry(dir, 'Root Entry', 5, 0xfffffffe, 0);
  entry(dir + 128, 'Workbook', 2, 2, stream.length);
  out.set(data, 512 * 3);
  return out;
}

test('cells, shared strings across CONTINUE, RK and MULRK numbers, dates, formula results', () => {
  const [s] = readXls(compoundFile(workbookStream()));
  expect(s.name).toBe('Sales');
  expect(s.rows[0]).toEqual(['Name', 'Customer', 'Total', 'When']);
  expect(s.rows[1].slice(0, 3)).toEqual(['Ann', 12.75, 40]);
  expect(s.rows[1][3]).toBeInstanceOf(XDate);
  expect(formatValue(s.rows[1][3])).toBe('3 Jan 2026');
  expect(s.rows[2]).toEqual([null, 12.34, -5]);
  expect(s.rows[3]).toEqual([null, 52.75, 'done', true]);
  expect(s.formulas).toBe(2);
});

test('through readFile: a spreadsheet with a summary', async () => {
  const r = await readFile(memorySource(compoundFile(workbookStream())), 'old.xls');
  expect(r.kind).toBe('sheet');
  if (r.kind === 'sheet') expect(r.summary).toContain('Sheet "Sales": 3 rows, 4 columns');
});

test('not an Excel file, and BIFF5', () => {
  expect(() => readXls(new Uint8Array(600))).toThrow('not an Excel file');
  const old = workbookStream();
  old[4] = 0x00;
  old[5] = 0x05; // BIFF5
  expect(() => readXls(compoundFile(old))).toThrow(/Excel 95/);
});

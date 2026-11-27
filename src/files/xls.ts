/**
 * Old Excel workbooks (.xls, Excel 97–2003, "BIFF8"): the Workbook stream out of the compound
 * file, then each sheet's cells, with the values formulas last worked out. Older BIFF5 files and
 * password-protected ones are refused with a plain reason. Pure.
 */
import { f64, u16, u32 } from './bytes';
import { isDateFormat, Budget } from './workbooks';
import { type Scalar, type Sheet, SHEET_LIMITS, XDate, XErr } from './sheet';

export class XlsError extends Error {}

const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const FREE = 0xffffffff;

/** A compound file's ("OLE") stream called [want], or null. */
export function cfbStream(b: Uint8Array, want: string[]): Uint8Array | null {
  if (b.length < 512 || SIG.some((x, i) => b[i] !== x)) throw new XlsError('not an Excel file');
  const shift = u16(b, 0x1e);
  const ss = 1 << shift;
  const miniSs = 1 << u16(b, 0x20);
  const nFat = u32(b, 0x2c);
  const dirStart = u32(b, 0x30);
  const cutoff = u32(b, 0x38);
  const miniFatStart = u32(b, 0x3c);
  let difatNext = u32(b, 0x44);
  const sector = (n: number) => 512 + n * ss;
  // The FAT's sectors: 109 listed in the header, the rest in DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) {
    const s = u32(b, 0x4c + i * 4);
    if (s !== FREE) fatSectors.push(s);
  }
  let guard = 0;
  while (difatNext !== END && difatNext !== FREE && fatSectors.length < nFat && guard++ < 10_000) {
    const base = sector(difatNext);
    for (let i = 0; i < ss / 4 - 1 && fatSectors.length < nFat; i++) {
      const s = u32(b, base + i * 4);
      if (s !== FREE) fatSectors.push(s);
    }
    difatNext = u32(b, base + ss - 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const base = sector(s);
    for (let i = 0; i < ss / 4; i++)
      fat.push(base + i * 4 + 4 <= b.length ? u32(b, base + i * 4) : FREE);
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    let s = start;
    while (s !== END && s !== FREE && s < table.length && out.length < table.length) {
      out.push(s);
      s = table[s];
    }
    return out;
  };
  const readChain = (start: number, size: number) => {
    const out = new Uint8Array(size);
    let at = 0;
    for (const s of chain(start, fat)) {
      if (at >= size) break;
      const base = sector(s);
      const n = Math.min(ss, size - at, Math.max(0, b.length - base));
      out.set(b.subarray(base, base + n), at);
      at += n;
    }
    return out.subarray(0, at);
  };
  const dirBytes = readChain(dirStart, chain(dirStart, fat).length * ss);
  type Dir = { name: string; type: number; start: number; size: number };
  const dirs: Dir[] = [];
  for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
    const len = u16(dirBytes, o + 0x40);
    let name = '';
    for (let i = 0; i + 2 < len && i < 64; i += 2)
      name += String.fromCharCode(u16(dirBytes, o + i));
    dirs.push({
      name,
      type: dirBytes[o + 0x42],
      start: u32(dirBytes, o + 0x74),
      size: u32(dirBytes, o + 0x78),
    });
  }
  const root = dirs.find((d) => d.type === 5);
  const hit = dirs.find((d) => d.type === 2 && want.includes(d.name));
  if (!hit) return null;
  if (hit.size >= cutoff || !root) return readChain(hit.start, hit.size);
  // A small stream lives in the mini stream (64-byte sectors inside the root's stream).
  const mini = readChain(root.start, root.size);
  const miniFatBytes = readChain(miniFatStart, chain(miniFatStart, fat).length * ss);
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(u32(miniFatBytes, i));
  const out = new Uint8Array(hit.size);
  let at = 0;
  for (const s of chain(hit.start, miniFat)) {
    const n = Math.min(miniSs, hit.size - at);
    out.set(mini.subarray(s * miniSs, s * miniSs + n), at);
    at += n;
    if (at >= hit.size) break;
  }
  return out.subarray(0, at);
}

type Rec = { type: number; data: Uint8Array; pos: number };

function records(s: Uint8Array): Rec[] {
  const out: Rec[] = [];
  let p = 0;
  while (p + 4 <= s.length) {
    const type = u16(s, p);
    const len = u16(s, p + 2);
    out.push({ type, data: s.subarray(p + 4, p + 4 + len), pos: p });
    p += 4 + len;
  }
  return out;
}

/** Reads strings that may run on into CONTINUE records (each piece starts with a new flag byte). */
class Pieces {
  i = 0;
  o = 0;
  constructor(private parts: Uint8Array[]) {}
  private fix() {
    while (this.i < this.parts.length && this.o >= this.parts[this.i].length) {
      this.i++;
      this.o = 0;
    }
  }
  byte(): number {
    this.fix();
    const p = this.parts[this.i];
    return p ? p[this.o++] : 0;
  }
  u16() {
    return this.byte() | (this.byte() << 8);
  }
  u32() {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number) {
    while (n > 0) {
      this.fix();
      const p = this.parts[this.i];
      if (!p) return;
      const k = Math.min(n, p.length - this.o);
      this.o += k;
      n -= k;
    }
  }
  /** A string of [cch] characters; at a piece boundary the next piece's first byte is new flags. */
  chars(cch: number, wide: boolean): string {
    let s = '';
    let left = cch;
    while (left > 0) {
      this.fix();
      const p = this.parts[this.i];
      if (!p) break;
      while (left > 0 && this.o < p.length) {
        if (wide) {
          s += String.fromCharCode(p[this.o] | (p[this.o + 1] << 8));
          this.o += 2;
        } else s += String.fromCharCode(p[this.o++]);
        left--;
      }
      if (left > 0) {
        this.i++;
        this.o = 0;
        if (this.i < this.parts.length) wide = (this.parts[this.i][this.o++] & 1) === 1;
      }
    }
    return s;
  }
}

/** XLUnicodeRichExtendedString (SST entries). */
function richString(p: Pieces): string {
  const cch = p.u16();
  const flags = p.byte();
  const runs = flags & 0x08 ? p.u16() : 0;
  const ext = flags & 0x04 ? p.u32() : 0;
  const s = p.chars(cch, (flags & 1) === 1);
  p.skip(runs * 4 + ext);
  return s;
}

/** XLUnicodeString inside one record: 16-bit length, flags, characters. */
function plainString(d: Uint8Array, o: number, shortLen = false): string {
  const cch = shortLen ? d[o] : u16(d, o);
  const at = o + (shortLen ? 1 : 2);
  const wide = (d[at] & 1) === 1;
  let s = '';
  for (let i = 0; i < cch; i++) {
    const k = at + 1 + (wide ? i * 2 : i);
    if (k >= d.length) break;
    s += String.fromCharCode(wide ? u16(d, k) : d[k]);
  }
  return s;
}

function rk(v: number): number {
  let n: number;
  if (v & 2) n = (v | 0) >> 2;
  else {
    const buf = new Uint8Array(8);
    const hi = (v & 0xfffffffc) >>> 0;
    buf[4] = hi & 0xff;
    buf[5] = (hi >> 8) & 0xff;
    buf[6] = (hi >> 16) & 0xff;
    buf[7] = (hi >>> 24) & 0xff;
    n = f64(buf, 0);
  }
  return v & 1 ? Number((n / 100).toPrecision(15)) : n;
}

const ERRORS: Record<number, string> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
};

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

export function readXls(file: Uint8Array): Sheet[] {
  const stream = cfbStream(file, ['Workbook', 'Book']);
  if (!stream) throw new XlsError('not an Excel workbook');
  const recs = records(stream);
  const bof = recs[0];
  if (!bof || bof.type !== 0x0809 || u16(bof.data, 0) !== 0x0600)
    throw new XlsError('made by Excel 95 or older; save it as .xlsx');
  const sst: string[] = [];
  const formats = new Map<number, string>();
  const xfDate: boolean[] = [];
  const bound: { name: string; pos: number; hidden: boolean }[] = [];
  let date1904 = false;
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k];
    if (r.type === 0x000a) break; // end of the workbook globals
    switch (r.type) {
      case 0x002f:
        throw new XlsError('password-protected');
      case 0x0022:
        date1904 = u16(r.data, 0) === 1;
        break;
      case 0x041e:
        formats.set(u16(r.data, 0), plainString(r.data, 2));
        break;
      case 0x00e0: {
        const id = u16(r.data, 2);
        xfDate.push(formats.has(id) ? isDateFormat(formats.get(id)!) : BUILTIN_DATES.has(id));
        break;
      }
      case 0x0085:
        if (r.data[5] === 0)
          bound.push({
            pos: u32(r.data, 0),
            hidden: (r.data[4] & 3) !== 0,
            name: plainString(r.data, 6, true),
          });
        break;
      case 0x00fc: {
        const parts = [r.data.subarray(8)];
        while (recs[k + 1]?.type === 0x003c) parts.push(recs[++k].data);
        const p = new Pieces(parts);
        const n = u32(r.data, 4);
        for (let i = 0; i < n; i++) sst.push(richString(p));
        break;
      }
    }
  }
  const byPos = new Map(recs.map((r, i) => [r.pos, i]));
  const budget = new Budget();
  const sheets: Sheet[] = [];
  for (const b of bound) {
    const sheet: Sheet = {
      name: b.name,
      rows: [],
      truncated: false,
      formulas: 0,
      uncached: 0,
      hidden: b.hidden || undefined,
    };
    sheets.push(sheet);
    let k = byPos.get(b.pos);
    if (k == null) continue;
    const set = (row: number, col: number, xf: number, v: Scalar) => {
      if (row >= SHEET_LIMITS.maxRows || col >= SHEET_LIMITS.maxCols) {
        sheet.truncated = true;
        return;
      }
      if (typeof v === 'number' && xfDate[xf]) v = new XDate(date1904 ? v + 1462 : v);
      if (!budget.take()) {
        sheet.truncated = true;
        return;
      }
      while (sheet.rows.length <= row) sheet.rows.push([]);
      const r = sheet.rows[row];
      while (r.length < col) r.push(null);
      r[col] = v;
    };
    let pending: { row: number; col: number; xf: number } | null = null;
    for (k++; k < recs.length; k++) {
      const { type, data: d } = recs[k];
      if (type === 0x000a) break;
      switch (type) {
        case 0x00fd:
          set(u16(d, 0), u16(d, 2), u16(d, 4), sst[u32(d, 6)] ?? '');
          break;
        case 0x0203:
          set(u16(d, 0), u16(d, 2), u16(d, 4), f64(d, 6));
          break;
        case 0x027e:
          set(u16(d, 0), u16(d, 2), u16(d, 4), rk(u32(d, 6)));
          break;
        case 0x00bd: {
          const row = u16(d, 0);
          const first = u16(d, 2);
          const n = (d.length - 6) / 6;
          for (let i = 0; i < n; i++) set(row, first + i, u16(d, 4 + i * 6), rk(u32(d, 6 + i * 6)));
          break;
        }
        case 0x0204:
          set(u16(d, 0), u16(d, 2), u16(d, 4), plainString(d, 6));
          break;
        case 0x0205: {
          const v = d[6];
          set(u16(d, 0), u16(d, 2), u16(d, 4), d[7] ? new XErr(ERRORS[v] ?? '#VALUE!') : v === 1);
          break;
        }
        case 0x0006: {
          sheet.formulas++;
          const row = u16(d, 0);
          const col = u16(d, 2);
          const xf = u16(d, 4);
          if (d[12] === 0xff && d[13] === 0xff) {
            const kind = d[6];
            if (kind === 0) pending = { row, col, xf };
            else if (kind === 1) set(row, col, xf, d[8] === 1);
            else if (kind === 2) set(row, col, xf, new XErr(ERRORS[d[8]] ?? '#VALUE!'));
          } else set(row, col, xf, f64(d, 6));
          break;
        }
        case 0x0207:
          if (pending) set(pending.row, pending.col, pending.xf, plainString(d, 0));
          pending = null;
          break;
      }
    }
    for (const r of sheet.rows)
      while (r.length && (r[r.length - 1] == null || r[r.length - 1] === '')) r.pop();
    while (sheet.rows.length && !sheet.rows[sheet.rows.length - 1].length) sheet.rows.pop();
  }
  return sheets;
}

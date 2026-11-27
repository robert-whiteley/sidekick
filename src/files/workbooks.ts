/**
 * Excel (.xlsx) and OpenDocument (.ods) workbooks: every sheet's cells with the values formulas
 * last worked out (saved in the file), dates told apart from numbers by their cell format.
 * Pure (reads through a ByteSource). Old Excel (.xls) is in xls.ts.
 */
import type { ByteSource } from './bytes';
import { zipText } from './office';
import { parseDate, type Scalar, type Sheet, SHEET_LIMITS, XDate, XErr, colIndex } from './sheet';
import { attr, local, scanXml } from './xml';
import { findEntry, resolvePath, type ZipEntry, ZipEntryError } from './zip';

/** Unpacked bytes read from one sheet's XML (about 300,000 cells). */
const SHEET_XML_BYTES = 60_000_000;

/** Excel's built-in date and time formats (by number). */
const BUILTIN_DATES = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

/** A number format that shows a date or time ("dd/mm/yyyy", "[$-409]mmm d", "h:mm"). */
export function isDateFormat(code: string): boolean {
  const s = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .toLowerCase();
  if (/general/.test(s) && !/[dmyhs]/.test(s.replace('general', ''))) return false;
  return /[dy]|(^|[^a-z])m+([^a-z]|$)|h+|s+/.test(s) && !/^[#0.,% ]*$/.test(s);
}

export class Budget {
  cells = 0;
  full = false;
  take(n = 1): boolean {
    if (this.cells + n > SHEET_LIMITS.maxCells) {
      this.full = true;
      return false;
    }
    this.cells += n;
    return true;
  }
}

/** Cell "C12" → [row 11, column 2]. */
function cellPos(ref: string): [number, number] | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(ref);
  if (!m) return null;
  return [Number(m[2]) - 1, colIndex(m[1])];
}

function put(rows: Scalar[][], r: number, c: number, v: Scalar) {
  while (rows.length <= r) rows.push([]);
  const row = rows[r];
  while (row.length < c) row.push(null);
  row[c] = v;
}

function trimRows(rows: Scalar[][]) {
  const empty = (v: Scalar) => v == null || v === '';
  for (const r of rows) while (r.length && empty(r[r.length - 1])) r.pop();
  while (rows.length && !rows[rows.length - 1].length) rows.pop();
}

export async function readXlsx(src: ByteSource, entries: ZipEntry[]): Promise<Sheet[]> {
  const wbPath =
    entries.find((e) => /^xl\/workbook\.xml$/i.test(e.name))?.name ??
    entries.find((e) => /workbook\.xml$/i.test(e.name))?.name;
  if (!wbPath) throw new ZipEntryError('not an Excel workbook');
  const wb = await zipText(src, findEntry(entries, wbPath)!);
  const list: { name: string; rid: string; hidden: boolean }[] = [];
  let date1904 = false;
  scanXml(wb.text, {
    open: (name, a) => {
      const l = local(name);
      if (l === 'sheet') {
        const rid = attr(a, 'r:id') ?? attr(a, 'id');
        if (rid)
          list.push({
            name: attr(a, 'name') ?? 'Sheet',
            rid,
            hidden: !!attr(a, 'state') && attr(a, 'state') !== 'visible',
          });
      } else if (l === 'workbookPr') {
        const v = attr(a, 'date1904');
        date1904 = v === '1' || v === 'true';
      }
    },
  });
  // Relationship id → sheet part.
  const relsPath = resolvePath(wbPath, `_rels/${wbPath.split('/').pop()}.rels`);
  const targets = new Map<string, string>();
  const relsEntry = findEntry(entries, relsPath);
  if (relsEntry)
    scanXml((await zipText(src, relsEntry)).text, {
      open: (name, a) => {
        if (local(name) !== 'Relationship') return;
        const id = attr(a, 'Id');
        const t = attr(a, 'Target');
        if (id && t) targets.set(id, resolvePath(wbPath, t));
      },
    });
  const shared = await sharedStrings(src, entries);
  const dateStyles = await xlsxDateStyles(src, entries);
  const budget = new Budget();
  const sheets: Sheet[] = [];
  for (const s of list) {
    const path = targets.get(s.rid);
    const e = path ? findEntry(entries, path) : undefined;
    if (!e) continue;
    if (budget.full) {
      sheets.push({
        name: s.name,
        rows: [],
        truncated: true,
        formulas: 0,
        uncached: 0,
        hidden: s.hidden,
      });
      continue;
    }
    const x = await zipText(src, e, SHEET_XML_BYTES);
    const sheet = xlsxSheet(x.text, s.name, shared, dateStyles, date1904, budget);
    sheet.truncated ||= x.truncated;
    if (s.hidden) sheet.hidden = true;
    sheets.push(sheet);
  }
  return sheets;
}

async function sharedStrings(src: ByteSource, entries: ZipEntry[]): Promise<string[]> {
  const e = entries.find((x) => /sharedStrings\.xml$/i.test(x.name));
  if (!e) return [];
  const out: string[] = [];
  let cur: string[] | null = null;
  let inT = false;
  let phonetic = 0;
  scanXml((await zipText(src, e, SHEET_XML_BYTES)).text, {
    open: (name, _a, self) => {
      const l = local(name);
      if (l === 'si') cur = [];
      else if (l === 'rPh' && !self) phonetic++;
      else if (l === 't' && !self) inT = true;
    },
    close: (name) => {
      const l = local(name);
      if (l === 'si') {
        out.push((cur ?? []).join(''));
        cur = null;
      } else if (l === 'rPh') phonetic--;
      else if (l === 't') inT = false;
    },
    text: (t) => {
      if (inT && !phonetic && cur) cur.push(t);
    },
  });
  return out;
}

/** Which cell styles (by index) show dates. */
async function xlsxDateStyles(src: ByteSource, entries: ZipEntry[]): Promise<boolean[]> {
  const e = entries.find((x) => /styles\.xml$/i.test(x.name));
  if (!e) return [];
  const custom = new Map<number, string>();
  const out: boolean[] = [];
  let inXfs = false;
  scanXml((await zipText(src, e)).text, {
    open: (name, a) => {
      const l = local(name);
      if (l === 'numFmt') {
        const id = Number(attr(a, 'numFmtId'));
        custom.set(id, attr(a, 'formatCode') ?? '');
      } else if (l === 'cellXfs') inXfs = true;
      else if (l === 'xf' && inXfs) {
        const id = Number(attr(a, 'numFmtId') ?? 0);
        out.push(custom.has(id) ? isDateFormat(custom.get(id)!) : BUILTIN_DATES.has(id));
      }
    },
    close: (name) => {
      if (local(name) === 'cellXfs') inXfs = false;
    },
  });
  return out;
}

/** One sheet's XML → its rows. Formula cells keep the value Excel saved for them. */
export function xlsxSheet(
  xml: string,
  name: string,
  shared: string[],
  dateStyles: boolean[],
  date1904: boolean,
  budget = new Budget(),
): Sheet {
  const rows: Scalar[][] = [];
  let formulas = 0;
  let uncached = 0;
  let truncated = false;
  let rowIdx = -1;
  let col = -1;
  let type = '';
  let style = 0;
  let value: string[] | null = null;
  let inline: string[] | null = null;
  let hasFormula = false;
  let inV = false;
  let inT = false;
  scanXml(
    xml,
    {
      open: (tag, a, self) => {
        const l = local(tag);
        if (l === 'row') {
          const r = attr(a, 'r');
          rowIdx = r ? Number(r) - 1 : rowIdx + 1;
          col = -1;
          if (rowIdx >= SHEET_LIMITS.maxRows) truncated = true;
        } else if (l === 'c') {
          const ref = attr(a, 'r');
          const pos = ref ? cellPos(ref) : null;
          if (pos) {
            rowIdx = pos[0];
            col = pos[1];
          } else col++;
          type = attr(a, 't') ?? 'n';
          style = Number(attr(a, 's') ?? 0);
          value = null;
          inline = null;
          hasFormula = false;
          if (self) value = null;
        } else if (l === 'f') hasFormula = true;
        else if (l === 'v' && !self) {
          inV = true;
          value = [];
        } else if (l === 'is') inline = [];
        else if (l === 't' && inline && !self) inT = true;
      },
      close: (tag) => {
        const l = local(tag);
        if (l === 'v') inV = false;
        else if (l === 't') inT = false;
        else if (l === 'c') {
          if (truncated || col >= SHEET_LIMITS.maxCols || rowIdx >= SHEET_LIMITS.maxRows) return;
          if (hasFormula) {
            formulas++;
            if (value == null) uncached++;
          }
          const raw = value?.join('') ?? null;
          let v: Scalar = null;
          if (type === 'inlineStr') v = (inline ?? []).join('');
          else if (raw == null) v = null;
          else if (type === 's') v = shared[Number(raw)] ?? '';
          else if (type === 'str') v = raw;
          else if (type === 'b') v = raw === '1' || raw === 'true';
          else if (type === 'e') v = new XErr(raw);
          else if (type === 'd') v = parseDate(raw) ?? raw;
          else {
            const n = Number(raw);
            v = Number.isNaN(n) ? raw : dateStyles[style] ? new XDate(date1904 ? n + 1462 : n) : n;
          }
          if (v == null) return;
          if (!budget.take()) {
            truncated = true;
            return;
          }
          put(rows, rowIdx, col, v);
        }
      },
      text: (t) => {
        if (inV && value) value.push(t);
        else if (inT && inline) inline.push(t);
      },
    },
    () => truncated && budget.full,
  );
  trimRows(rows);
  return { name, rows, truncated: truncated || budget.full, formulas, uncached };
}

// --- OpenDocument spreadsheets ---

export async function readOds(src: ByteSource, entries: ZipEntry[]): Promise<Sheet[]> {
  const e = findEntry(entries, 'content.xml');
  if (!e) throw new ZipEntryError('not an OpenDocument spreadsheet');
  const x = await zipText(src, e, SHEET_XML_BYTES);
  const sheets = odsSheets(x.text);
  if (x.truncated) for (const s of sheets) s.truncated = true;
  return sheets;
}

/** Repeated empty rows and cells (a sheet "ends" at row 1,048,576) are not made one by one. */
const MAX_REPEAT = 1000;

export function odsSheets(xml: string, budget = new Budget()): Sheet[] {
  const sheets: Sheet[] = [];
  let cur: Sheet | null = null;
  let row: Scalar[] | null = null;
  let rowRepeat = 1;
  let cell: { v: Scalar; type: string; repeat: number; text: string[]; formula: boolean } | null =
    null;
  let pDepth = 0;
  let skip = 0;
  let rowFormulas = 0;
  scanXml(xml, {
    open: (name, a, self) => {
      if (skip) {
        if (!self) skip++;
        return;
      }
      if (name === 'table:table') {
        cur = {
          name: attr(a, 'table:name') ?? `Sheet${sheets.length + 1}`,
          rows: [],
          truncated: false,
          formulas: 0,
          uncached: 0,
        };
        sheets.push(cur);
      } else if (name === 'table:table-row' && cur) {
        row = [];
        rowRepeat = Math.max(1, Number(attr(a, 'table:number-rows-repeated') ?? 1));
        if (self) endRow();
      } else if ((name === 'table:table-cell' || name === 'table:covered-table-cell') && row) {
        const type = attr(a, 'office:value-type') ?? '';
        let v: Scalar = null;
        if (type === 'float' || type === 'currency' || type === 'percentage')
          v = Number(attr(a, 'office:value'));
        else if (type === 'date') v = parseDate(attr(a, 'office:date-value') ?? '');
        else if (type === 'boolean') v = attr(a, 'office:boolean-value') === 'true';
        else if (type === 'time') v = odsTime(attr(a, 'office:time-value') ?? '');
        else if (type === 'string' && attr(a, 'office:string-value') != null)
          v = attr(a, 'office:string-value');
        cell = {
          v,
          type,
          repeat: Math.max(1, Number(attr(a, 'table:number-columns-repeated') ?? 1)),
          text: [],
          formula: attr(a, 'table:formula') != null,
        };
        if (self) endCell();
      } else if (name === 'text:p' && cell) {
        if (!self) pDepth++;
        if (cell.text.length) cell.text.push('\n');
      } else if (name === 'text:s' && cell && pDepth) {
        cell.text.push(' '.repeat(Math.min(50, Number(attr(a, 'text:c') ?? 1))));
      } else if (name === 'office:annotation' && !self) skip = 1;
    },
    close: (name) => {
      if (skip) {
        skip--;
        return;
      }
      if (name === 'text:p') pDepth--;
      else if ((name === 'table:table-cell' || name === 'table:covered-table-cell') && cell)
        endCell();
      else if (name === 'table:table-row' && row) endRow();
      else if (name === 'table:table' && cur) {
        trimRows(cur.rows);
        cur = null;
      }
    },
    text: (t) => {
      if (cell && pDepth) cell.text.push(t);
    },
  });
  function endCell() {
    if (!cell || !row || !cur) return;
    let v = cell.v;
    if (v == null && !cell.type) v = null;
    if (v == null && cell.text.length) v = cell.text.join('');
    if (typeof v === 'number' && Number.isNaN(v)) v = null;
    if (cell.formula) {
      cur.formulas += cell.repeat;
      rowFormulas += cell.repeat;
      if (v == null) cur.uncached += cell.repeat;
    }
    const empty = v == null || v === '';
    const n = empty
      ? Math.min(cell.repeat, MAX_REPEAT)
      : Math.min(cell.repeat, SHEET_LIMITS.maxCols);
    for (let i = 0; i < n && row.length < SHEET_LIMITS.maxCols; i++) row.push(v);
    cell = null;
  }
  function endRow() {
    if (!row || !cur) return;
    while (row.length && (row[row.length - 1] == null || row[row.length - 1] === '')) row.pop();
    const n = row.length ? rowRepeat : Math.min(rowRepeat, MAX_REPEAT);
    cur.formulas += rowFormulas * (n - 1);
    rowFormulas = 0;
    for (let i = 0; i < n; i++) {
      if (cur.rows.length >= SHEET_LIMITS.maxRows || !budget.take(row.length)) {
        cur.truncated = true;
        break;
      }
      cur.rows.push(i ? [...row] : row);
    }
    row = null;
  }
  return sheets;
}

/** "PT14H30M00S" → the time as a fraction of a day. */
function odsTime(v: string): Scalar {
  const m = /^PT(\d+)H(\d+)M(\d+(?:\.\d+)?)S$/.exec(v);
  return m ? new XDate((+m[1] * 3600 + +m[2] * 60 + +m[3]) / 86400) : v || null;
}

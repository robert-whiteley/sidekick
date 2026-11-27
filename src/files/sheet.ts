/**
 * Spreadsheets as Sidekick reads them: cells (numbers, text, true/false, dates, errors), which
 * row is the header, a short summary (sheets, columns, what is in them) and CSV in and out.
 * Every reader (CSV/TSV, .xlsx, .xls, .ods) produces these; the formulas run on them
 * (formula.ts). Pure.
 */

/** A date (and time) as a spreadsheet serial number: days since 30 Dec 1899, time as a fraction. */
export class XDate {
  constructor(readonly serial: number) {}
}

/** A spreadsheet error value (#DIV/0!, #N/A…), with a plain reason when Sidekick made it. */
export class XErr {
  constructor(
    readonly code: string,
    readonly why?: string,
  ) {}
}

export type Scalar = number | string | boolean | null | XDate | XErr;

export type Sheet = {
  name: string;
  rows: Scalar[][];
  /** Rows or cells left out (over the limits). */
  truncated: boolean;
  /** Cells with a formula, and those of them with no saved result. */
  formulas: number;
  uncached: number;
  hidden?: boolean;
};

export const SHEET_LIMITS = {
  maxCells: 1_000_000,
  maxRows: 200_000,
  maxCols: 500,
};

const DAY_MS = 86_400_000;
/** Serial number of 1 Jan 1970. */
const EPOCH = 25569;

export const serialFromMs = (ms: number) => ms / DAY_MS + EPOCH;
export const msFromSerial = (serial: number) => Math.round((serial - EPOCH) * DAY_MS);
/** A calendar date (UTC) as a serial number. */
export const serialOf = (y: number, m: number, d: number) => serialFromMs(Date.UTC(y, m - 1, d));

/** "A", "B", … "Z", "AA" for column [i] (0-based). */
export function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "AB" → 27 (0-based), or -1. */
export function colIndex(letters: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(letters)) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = MONTHS;

/** A number without floating-point noise (0.1 + 0.2 → "0.3"). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? 'infinity' : n < 0 ? '-infinity' : 'not a number';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

/** "3 Jan 2026", with the time when there is one ("3 Jan 2026 14:30"). */
export function formatDate(d: XDate): string {
  const ms = msFromSerial(d.serial);
  const t = new Date(ms);
  const date = `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
  const mins = Math.round((d.serial - Math.floor(d.serial)) * 1440);
  if (!mins || mins === 1440) return date;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${date} ${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

export function formatValue(v: Scalar): string {
  if (v == null) return '';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof XDate) return formatDate(v);
  if (v instanceof XErr) return v.code;
  return v;
}

const isEmpty = (v: Scalar) => v == null || v === '';

// --- The table in a sheet ---

export type Table = {
  sheet: Sheet;
  /** Index in rows of the header row, or -1 when the sheet has none. */
  headerRow: number;
  /** One per column: the header text, or "" when there is none. */
  headers: string[];
  width: number;
  /** Index in rows of the first data row. */
  first: number;
};

/** The sheet's columns and where its data starts: the first all-text row filling most columns. */
export function tableOf(sheet: Sheet): Table {
  const width = sheet.rows.reduce((w, r) => {
    let last = r.length - 1;
    while (last >= 0 && isEmpty(r[last])) last--;
    return Math.max(w, last + 1);
  }, 0);
  let headerRow = -1;
  for (let i = 0; i < Math.min(sheet.rows.length - 1, 10); i++) {
    const r = sheet.rows[i] ?? [];
    const filled = r.filter((v) => !isEmpty(v));
    if (!filled.length) continue;
    const allText = filled.every((v) => typeof v === 'string');
    if (allText && filled.length >= Math.max(1, Math.ceil(width / 2))) headerRow = i;
    // The first row with something in it decides, unless it is a lone title above the table.
    if (headerRow >= 0 || filled.length > 1 || width === 1) break;
  }
  if (headerRow >= 0 && !looksLikeData(sheet, headerRow, width)) headerRow = -1;
  const h = headerRow >= 0 ? sheet.rows[headerRow] : [];
  const headers = Array.from({ length: width }, (_, c) => {
    const v = h[c];
    return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  });
  let first = headerRow + 1;
  if (headerRow < 0) while (first < sheet.rows.length && sheet.rows[first].every(isEmpty)) first++;
  return { sheet, headerRow, headers, width, first };
}

/** A header row is followed by rows that aren't all text like it (or there are text columns). */
function looksLikeData(sheet: Sheet, headerRow: number, width: number): boolean {
  const next = sheet.rows.slice(headerRow + 1, headerRow + 30);
  if (!next.length) return false;
  if (next.some((r) => r.some((v) => !isEmpty(v) && typeof v !== 'string'))) return true;
  // All text: a header if its values are unique and differ from the rows under it.
  const h = sheet.rows[headerRow].slice(0, width).map((v) => String(v ?? '').toLowerCase());
  const unique = new Set(h.filter(Boolean)).size === h.filter(Boolean).length;
  return (
    unique && !next.some((r) => r.some((v, c) => String(v ?? '').toLowerCase() === h[c] && h[c]))
  );
}

/** "C (Amount)", or "C" for a column with no header. */
export const columnLabel = (t: Table, c: number) =>
  t.headers[c] ? `${colName(c)} (${t.headers[c]})` : colName(c);

/** Sheet row number (1-based, as the spreadsheet shows it) of data row [i]. */
export const rowNumber = (t: Table, i: number) => t.first + i + 1;

export const dataRows = (t: Table) => t.sheet.rows.slice(t.first);

/** One column's data (header row left out), the empty cells as null. */
export const columnValues = (t: Table, c: number): Scalar[] => dataRows(t).map((r) => r[c] ?? null);

type ColKind = 'numbers' | 'dates' | 'text' | 'true/false' | 'empty' | 'mixed';

function columnKind(values: Scalar[]): ColKind {
  const counts = { n: 0, d: 0, t: 0, b: 0 };
  let filled = 0;
  for (const v of values) {
    if (isEmpty(v) || v instanceof XErr) continue;
    filled++;
    if (typeof v === 'number') counts.n++;
    else if (v instanceof XDate) counts.d++;
    else if (typeof v === 'boolean') counts.b++;
    else counts.t++;
  }
  if (!filled) return 'empty';
  const most = Math.max(counts.n, counts.d, counts.t, counts.b);
  if (most < filled * 0.8) return 'mixed';
  return most === counts.n
    ? 'numbers'
    : most === counts.d
      ? 'dates'
      : most === counts.b
        ? 'true/false'
        : 'text';
}

/** One line about a column: its kind and range, or its few different values. */
export function describeColumn(t: Table, c: number): string {
  const values = columnValues(t, c);
  const kind = columnKind(values);
  const label = columnLabel(t, c);
  if (kind === 'numbers') {
    const nums = values.filter((v): v is number => typeof v === 'number');
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of nums) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return `${label}: numbers, ${formatNumber(lo)} to ${formatNumber(hi)}`;
  }
  if (kind === 'dates') {
    const ds = values.filter((v): v is XDate => v instanceof XDate).map((d) => d.serial);
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of ds) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return `${label}: dates, ${formatDate(new XDate(lo))} to ${formatDate(new XDate(hi))}`;
  }
  if (kind === 'empty') return `${label}: empty`;
  const distinct = new Map<string, number>();
  for (const v of values) {
    if (isEmpty(v)) continue;
    const s = formatValue(v);
    distinct.set(s, (distinct.get(s) ?? 0) + 1);
    if (distinct.size > 200) break;
  }
  const list = [...distinct.keys()];
  const quoted = (xs: string[]) => xs.map((x) => JSON.stringify(x.slice(0, 40))).join(', ');
  if (list.length <= 8) return `${label}: ${kind}, ${quoted(list)}`;
  const many = distinct.size > 200 ? 'over 200' : String(list.length);
  return `${label}: ${kind}, ${many} different, e.g. ${quoted(list.slice(0, 3))}`;
}

/** The workbook in a few lines: each sheet's size, where its header is, and its columns. */
export function sheetSummary(sheets: Sheet[], maxColumns = 40): string {
  const out: string[] = [];
  for (const s of sheets) {
    const t = tableOf(s);
    const n = s.rows.length - t.first;
    const where =
      t.headerRow >= 0
        ? `header in row ${t.headerRow + 1}, data in rows ${t.first + 1}–${s.rows.length}`
        : `no header row, data in rows ${t.first + 1}–${s.rows.length}`;
    out.push(
      `Sheet "${s.name}"${s.hidden ? ' (hidden)' : ''}: ${n} row${n === 1 ? '' : 's'}, ${t.width} column${t.width === 1 ? '' : 's'} (${where}).`,
    );
    for (let c = 0; c < Math.min(t.width, maxColumns); c++) out.push(`- ${describeColumn(t, c)}`);
    if (t.width > maxColumns) out.push(`- …and ${t.width - maxColumns} more columns`);
    if (s.formulas)
      out.push(
        `${s.formulas} cell${s.formulas === 1 ? ' has a formula' : 's have formulas'}${s.uncached ? ` (${s.uncached} with no saved result)` : ''}.`,
      );
    if (s.truncated) out.push('Too big to read all of it: only the first part was read.');
  }
  return out.join('\n');
}

/** The sheets as plain text for the model to read: rows of cells split by " | ". */
export function sheetText(sheets: Sheet[], maxChars = 400_000): string {
  const out: string[] = [];
  let total = 0;
  for (const s of sheets) {
    out.push(`Sheet "${s.name}":`);
    for (let i = 0; i < s.rows.length; i++) {
      const r = s.rows[i];
      if (r.every(isEmpty)) continue;
      const line = `Row ${i + 1}: ${r.map(formatValue).join(' | ')}`;
      out.push(line);
      total += line.length + 1;
      if (total > maxChars) return out.join('\n');
    }
    out.push('');
  }
  return out.join('\n').trim();
}

// --- CSV / TSV ---

/** The separator a CSV uses: the one that splits the first lines most evenly. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/, 20).filter((l) => l.trim());
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => splitCsvLine(l, d).length);
    if (!counts.length || counts[0] < 2) continue;
    const same = counts.filter((c) => c === counts[0]).length;
    const score = same * 100 + counts[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitCsvLine(line: string, d: string): string[] {
  return parseCsv(line, d, 1)[0] ?? [];
}

/** RFC 4180 CSV: quoted fields with "" for a quote, line breaks inside quotes. */
export function parseCsv(text: string, d: string, maxRows = SHEET_LIMITS.maxRows): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (c === d) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NUM = /^[-+]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?([eE][-+]?\d+)?$/;
const NUM_EU = /^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$|^[-+]?\d+,\d+$/;

/** "1,234.50", "$12", "12%", "(5)", "1.234,50" → a number; null when it isn't one. */
export function parseNumber(raw: string, decimalComma = false): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^[$€£¥₹]\s?|\s?[$€£¥₹]$|\s?(USD|EUR|GBP)$/g, '');
  let pct = false;
  if (s.endsWith('%')) {
    pct = true;
    s = s.slice(0, -1).trim();
  }
  s = s.replace(/[   ](?=\d{3}\b)/g, '');
  let v: number;
  if (!decimalComma && NUM.test(s)) v = Number(s.replace(/,/g, ''));
  else if (NUM_EU.test(s) && (decimalComma || /,\d{1,2}$/.test(s) || /\.\d{3}/.test(s)))
    v = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (decimalComma && /^[-+]?\d+(\.\d+)?$/.test(s)) v = Number(s);
  else return null;
  if (!Number.isFinite(v)) return null;
  if (pct) v = Number((v / 100).toPrecision(15));
  return neg ? -v : v;
}

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const NAMED =
  /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ -,]*(\d{4})$|^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/;

function monthOf(name: string): number {
  const i = MONTHS.findIndex((m) => name.toLowerCase().startsWith(m.toLowerCase()));
  return i < 0 ? 0 : i + 1;
}

function makeDate(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): XDate | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;
  const ms = Date.UTC(y, m - 1, d, hh, mm, ss);
  if (new Date(ms).getUTCDate() !== d) return null;
  return new XDate(serialFromMs(ms));
}

/** A date written as text ("2026-01-03", "3/1/2026", "3 Jan 2026"), or null. */
export function parseDate(raw: string, monthFirst = false): XDate | null {
  const s = raw.trim();
  let m = ISO.exec(s);
  if (m && (m[0].length === s.length || /^(Z|[+-]\d{2}:?\d{2})$/.test(s.slice(m[0].length))))
    return makeDate(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = DMY.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const [d, mo] = monthFirst ? [b, a] : [a, b];
    return makeDate(+m[3], mo, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  m = NAMED.exec(s);
  if (m) {
    if (m[1]) return makeDate(+m[3], monthOf(m[2]), +m[1]);
    return makeDate(+m[6], monthOf(m[4]), +m[5]);
  }
  return null;
}

/** Day/month order for slashed dates in one column: the values decide, else [monthFirst]. */
function columnMonthFirst(values: string[], monthFirst: boolean): boolean {
  for (const v of values) {
    const m = DMY.exec(v.trim());
    if (!m) continue;
    if (+m[1] > 12) return false;
    if (+m[2] > 12) return true;
  }
  return monthFirst;
}

/** One CSV field as a cell: numbers and dates read as such, IDs with leading zeros kept as text. */
export function csvValue(raw: string, monthFirst: boolean, decimalComma = false): Scalar {
  const s = raw.trim();
  if (!s) return null;
  const d = parseDate(s, monthFirst);
  if (d) return d;
  if (/^0\d/.test(s) && !/^0[.,]/.test(s)) return s;
  const n = parseNumber(s, decimalComma);
  if (n != null) return n;
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  return raw;
}

/** A CSV or TSV file's text as a sheet. */
export function csvSheet(
  text: string,
  name: string,
  monthFirst = false,
  delimiter?: string,
): Sheet {
  const d = delimiter ?? detectDelimiter(text);
  const raw = parseCsv(text.replace(/^﻿/, ''), d);
  let truncated = raw.length >= SHEET_LIMITS.maxRows;
  const width = Math.min(
    SHEET_LIMITS.maxCols,
    raw.reduce((w, r) => Math.max(w, r.length), 0),
  );
  // ";"-separated files come from places that write 1.234,56.
  const decimalComma = d === ';';
  const order = Array.from({ length: width }, (_, c) =>
    columnMonthFirst(
      raw.slice(0, 500).map((r) => r[c] ?? ''),
      monthFirst,
    ),
  );
  const rows: Scalar[][] = [];
  let cells = 0;
  for (const r of raw) {
    if (cells + r.length > SHEET_LIMITS.maxCells) {
      truncated = true;
      break;
    }
    rows.push(r.slice(0, width).map((v, c) => csvValue(v, order[c], decimalComma)));
    cells += r.length;
  }
  while (rows.length && rows[rows.length - 1].every(isEmpty)) rows.pop();
  return { name, rows, truncated, formulas: 0, uncached: 0 };
}

const csvField = (v: Scalar): string => {
  let s: string;
  if (v instanceof XDate) {
    const t = new Date(msFromSerial(v.serial)).toISOString();
    s = v.serial % 1 ? t.slice(0, 16).replace('T', ' ') : t.slice(0, 10);
  } else s = formatValue(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A sheet as CSV (dates as 2026-01-03), to save or share. */
export function toCsv(sheet: Sheet): string {
  return sheet.rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

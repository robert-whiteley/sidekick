/**
 * Sheets as an Excel (.xlsx) workbook: a changed spreadsheet is saved in the format it came in
 * (it was saved as CSV, which dropped the other sheets and turned an Excel file into text).
 * Values only: numbers, text, true/false, dates (with a date format) and errors; formulas and
 * formatting of the original are not kept. Pure (fflate zips it).
 */
import { strToU8, zipSync } from 'fflate';

import { colName, type Scalar, type Sheet, XDate, XErr } from './sheet';

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 can't hold (control codes) would make Excel refuse the file.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** Style 1: a date (numFmt 14), style 2: a date and time (numFmt 22). */
function cell(ref: string, v: Scalar): string {
  if (v === null || v === '') return '';
  if (v instanceof XDate) return `<c r="${ref}" s="${v.serial % 1 ? 2 : 1}"><v>${v.serial}</v></c>`;
  if (v instanceof XErr) return `<c r="${ref}" t="e"><v>${esc(v.code)}</v></c>`;
  if (typeof v === 'number')
    return Number.isFinite(v)
      ? `<c r="${ref}"><v>${v}</v></c>`
      : `<c r="${ref}" t="e"><v>#NUM!</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const rows = sheet.rows
    .map((r, i) => {
      const cells = r.map((v, c) => cell(`${colName(c)}${i + 1}`, v)).join('');
      return cells ? `<row r="${i + 1}">${cells}</row>` : '';
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rows}</sheetData></worksheet>`
  );
}

/** Excel's rules for a sheet name: 1–31 characters, none of []:*?/\, unique (any case). */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n, i) => {
    const base =
      n
        .replace(/[[\]:*?/\\]/g, ' ')
        .trim()
        .slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++)
      name = `${base.slice(0, 31 - String(k).length - 1)} ${k}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** The workbook's bytes. */
export function toXlsx(sheets: Sheet[]): Uint8Array {
  const names = sheetNames(sheets.map((s) => s.name));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      head +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      head +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      head +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets>` +
        sheets
          .map(
            (s, i) =>
              `<sheet name="${esc(names[i])}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`,
          )
          .join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      head +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${R}/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ),
    'xl/styles.xml': strToU8(
      head +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
        '</styleSheet>',
    ),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files, { level: 6 });
}

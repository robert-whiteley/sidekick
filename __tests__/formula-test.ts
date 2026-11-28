/**
 * The spreadsheet formula language (src/files/formula.ts) on a made-up sales sheet: answers are
 * worked out in code, exactly.
 */
import {
  addColumn,
  FORMULA_LIMITS,
  FormulaError,
  parseFormula,
  resultError,
  resultText,
  runFormula,
  splitFormulas,
} from '@/files/formula';
import { csvSheet } from '@/files/sheet';

const SALES = `Date,Customer,Region,Product,Qty,Price,Paid
2026-01-03,Ann,North,Tea,2,0.1,yes
2026-01-15,Bob,South,Coffee,1,0.2,no
2026-02-02,Ann,North,Coffee,3,4.5,yes
2026-02-20,Cara,East,Tea,5,1.25,yes
2026-03-01,Bob,South,Tea,4,2,no
2026-03-09,Dev,North,Cake,1,12.99,yes`;

const CODES = `Product,Code
Tea,T-1
Coffee,C-7
Cake,K-3`;

const sheets = [csvSheet(SALES, 'Sales', false), csvSheet(CODES, 'Codes', false)];
const now = Date.UTC(2026, 10, 27, 12);
const ctx = { sheets, sheet: 0, now };
const run = (f: string) => resultText(runFormula(f, ctx));

test('sums are exact, with header names, letters and cell ranges', () => {
  expect(run('=0.1+0.2')).toBe('0.3');
  expect(run('SUM([Price])')).toBe('21.04');
  expect(run('SUM(F:F)')).toBe('21.04');
  expect(run('SUM(F2:F3)')).toBe('0.3');
  expect(run('SUMPRODUCT([Qty],[Price])')).toBe('41.14');
  expect(run('ROUND(AVERAGE(Price), 2)')).toBe('3.51');
});

test('conditional totals and counts', () => {
  expect(run('SUMIFS([Qty],[Region],"North")')).toBe('6');
  expect(run('COUNTIFS([Customer],"Ann",[Paid],"yes")')).toBe('2');
  expect(run('COUNTIF([Qty],">2")')).toBe('3');
  expect(run('ROUND(AVERAGEIFS([Price],[Product],"T*"),4)')).toBe('1.1167');
  expect(run('SUMIFS([Qty],[Date],">="&DATE(2026,2,1),[Date],"<"&DATE(2026,3,1))')).toBe('8');
  expect(run('MAXIFS([Price],[Paid],"no")')).toBe('2');
});

test('per-group results', () => {
  expect(run('GROUPBY([Customer],[Qty],SUM)')).toContain('Ann: 5');
  const months = run('GROUPBY(TEXT([Date],"yyyy-mm"),[Qty]*[Price],SUM)');
  expect(months).toContain('2026-01: 0.4');
  expect(months).toContain('2026-02: 19.75');
  expect(run('HSTACK(UNIQUE([Region]),SUMIFS([Qty],[Region],UNIQUE([Region])))')).toContain(
    'South: 5',
  );
  expect(run('PIVOTBY([Region],[Product],[Qty],SUM)')).toMatch(/North/);
});

test('lookups, filters, ranking and running totals', () => {
  expect(run('XLOOKUP("Cake",[Product],[Customer])')).toBe('Dev');
  expect(run('VLOOKUP("Coffee",Codes!A:B,2,FALSE)')).toBe('C-7');
  expect(run('XLOOKUP("Pie",[Product],[Customer],"none")')).toBe('none');
  expect(run('FILTER([Customer],[Paid]="no")')).toBe('Row 3: Bob\nRow 6: Bob');
  expect(run('TAKE(SORTBY([Customer],[Price],-1),1)')).toContain('Dev');
  expect(run('SCAN(0,[Qty],LAMBDA(a,x,a+x))')).toContain('16');
  expect(run('INDEX([Customer],MATCH(MAX([Qty]),[Qty],0))')).toBe('Cara');
});

test('dates, text, percentages, LET', () => {
  expect(run('DATEDIF(MIN([Date]),MAX([Date]),"d")')).toBe('65');
  expect(run('MAX([Date])-MIN([Date])')).toBe('65');
  expect(run('TEXT(SUMIFS([Qty],[Region],"North")/SUM([Qty]),"0.0%")')).toBe('37.5%');
  expect(run('LET(n,COUNTA([Customer]),n*2)')).toBe('12');
  expect(run('UPPER(LEFT("sidekick",4))&"!"')).toBe('SIDE!');
  expect(run('YEAR(TODAY())')).toBe('2026');
  expect(run('EOMONTH(DATE(2026,2,10),0)')).toBe('28 Feb 2026');
});

test('add a column', () => {
  const r = addColumn(ctx, 'Total', '[Qty]*[Price]');
  expect(r.col).toBe(7);
  expect(r.sheet.rows[0][7]).toBe('Total');
  expect(r.values).toEqual([0.2, 0.2, 13.5, 6.25, 8, 12.99]);
  // The original sheet is left as it was.
  expect(sheets[0].rows[0]).toHaveLength(7);
  const more = { ...ctx, sheets: [r.sheet, sheets[1]] };
  expect(resultText(runFormula('SUM([Total])', more))).toBe('41.14');
  expect(() => addColumn(ctx, 'X', 'UNIQUE([Customer])')).toThrow(FormulaError);
});

test('a new column from a first-row formula is filled down, as in a spreadsheet', () => {
  // "=B2*0.20" for VAT gave the first row's VAT in every row (phone check, 28 Nov).
  expect(addColumn(ctx, 'VAT', '=F2*0.2').values).toEqual([0.02, 0.04, 0.9, 0.25, 0.4, 2.598]);
  // $ keeps a row; ranges stay put (a share of the total).
  expect(addColumn(ctx, 'x', 'E2*$F$2').values).toEqual([0.2, 0.1, 0.3, 0.5, 0.4, 0.1]);
  expect(addColumn(ctx, 'Share', 'E2/SUM(E2:E7)').values.map((v) => Number(v).toFixed(3))).toEqual([
    '0.125',
    '0.063',
    '0.188',
    '0.313',
    '0.250',
    '0.063',
  ]);
  // [F2]: no column has that name, so it is the cell F2 (the model wrote "=[B2]*0.20").
  expect(addColumn(ctx, 'VAT', '=[F2]*0.2').values).toEqual([0.02, 0.04, 0.9, 0.25, 0.4, 2.598]);
  // A constant is the same in every row.
  expect(addColumn(ctx, 'One', '1').values).toEqual([1, 1, 1, 1, 1, 1]);
});

test('plain errors for mistakes', () => {
  expect(() => parseFormula('SUM([Qty]')).toThrow(FormulaError);
  expect(() => runFormula('SUM([Nope])', ctx)).toThrow(/Nope/);
  expect(() => runFormula('FROBNICATE(1)', ctx)).toThrow(/FROBNICATE/);
  expect(() => runFormula('SUM(Missing!A:A)', ctx)).toThrow(/no sheet/);
  expect(resultError(runFormula('1/0', ctx))).toMatch(/#DIV\/0!/);
  expect(() => parseFormula('1+'.repeat(FORMULA_LIMITS.length))).toThrow(/too long/);
  const steps = FORMULA_LIMITS.steps;
  FORMULA_LIMITS.steps = 100_000;
  try {
    expect(() =>
      runFormula('REDUCE(0,SEQUENCE(100000),LAMBDA(a,x,a+SUM(SEQUENCE(100))))', ctx),
    ).toThrow(/too long/);
  } finally {
    FORMULA_LIMITS.steps = steps;
  }
});

test('a sheet name with a hyphen or a space works without quotes (a shared file-name.csv)', () => {
  // The model wrote "sk-test-runs!B2:B5" for a shared sk-test-runs.csv (phone check, 28 Nov).
  const runs = csvSheet('Date,Distance km\n2026-11-02,5.2\n2026-11-23,10.1', 'my-runs', false);
  const two = [runs, csvSheet('A\n1\n2', 'Old data', false)];
  const r = (f: string) => resultText(runFormula(f, { sheets: two, sheet: 0, now }));
  expect(r('MAX(my-runs!B2:B3)')).toBe('10.1');
  expect(r('=MAX(MY-RUNS![Distance km])')).toBe('10.1');
  expect(r('SUM(Old data!A2:A3)')).toBe('3');
  expect(r("SUM('Old data'!A2:A3)")).toBe('3');
  // A minus between names is still a minus when no sheet has that name.
  expect(run('[Qty]-[Qty]')).not.toBe('');
});

test('several formulas split only at a top-level ";"', () => {
  expect(splitFormulas('=SUM(C:C) ; SUMIF(A:A, "Red", C:C);')).toEqual([
    '=SUM(C:C)',
    'SUMIF(A:A, "Red", C:C)',
  ]);
  // Inside brackets, quotes and braces a ";" stays: arguments, text and array rows.
  expect(splitFormulas('=SUMIF(A:A; "a;b"; C:C)')).toEqual(['=SUMIF(A:A; "a;b"; C:C)']);
  expect(splitFormulas("=SUM({1,2;3,4}) + 'x;y'!A1")).toEqual(["=SUM({1,2;3,4}) + 'x;y'!A1"]);
  expect(splitFormulas('=[Net; price]*2')).toEqual(['=[Net; price]*2']);
});

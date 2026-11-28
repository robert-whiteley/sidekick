/**
 * A small, safe spreadsheet formula language for questions about a sheet. The model writes an
 * Excel-style formula (=SUMIFS([Amount],[Status],"unpaid"), =GROUPBY(TEXT([Date],"yyyy-mm"),
 * [Amount],SUM), =XLOOKUP("Bob",[Name],[Phone])); this parses and works it out exactly on the
 * sheet's cells. Nothing is ever run as code: it is its own parser and evaluator, with a step
 * budget, a depth limit and a cap on array sizes.
 *
 * Columns: [Header] (or a header without spaces written bare), C:C or A:D (data rows, header
 * left out), single cells C5 and ranges A2:C10 as the sheet numbers them, 'Other sheet'![Col].
 * Arrays work element by element as in Excel 365 ([Amount]*1.2 is a column), so a formula giving
 * one value per row can become a new column. Pure; tested in __tests__/formula-test.ts.
 */
import {
  colIndex,
  colName,
  formatNumber,
  formatValue,
  MONTH_NAMES,
  msFromSerial,
  parseDate,
  parseNumber,
  type Scalar,
  type Sheet,
  serialFromMs,
  serialOf,
  tableOf,
  type Table,
  XDate,
  XErr,
} from './sheet';

// --- Values ---

export class Arr {
  constructor(
    readonly rows: number,
    readonly cols: number,
    readonly data: Scalar[],
    /** Column headers, when the array came from named columns or made a table. */
    readonly headers?: string[],
    /** Sheet row number (1-based) of each row, when it is rows of the sheet. */
    readonly rowNos?: number[],
  ) {}
  at(r: number, c: number): Scalar {
    return this.data[r * this.cols + c] ?? null;
  }
}

class Fn {
  constructor(
    readonly name: string,
    readonly call: (args: Value[]) => Value,
  ) {}
}

export type Value = Scalar | Arr | Fn;

/** A formula that can't be read or worked out, with the reason in plain words. */
export class FormulaError extends Error {}

export const FORMULA_LIMITS = {
  /** Work units (a cell looked at, a function called): about a second on a mid-range phone. */
  steps: 5_000_000,
  /** And a clock limit, for work the units undercount. */
  ms: 10_000,
  depth: 200,
  cells: 2_000_000,
  length: 2000,
};

// --- Tokens ---

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'col'; v: string }
  | { t: 'sheet'; v: string }
  | { t: 'op'; v: string };

const OPS = [
  '<=',
  '>=',
  '<>',
  '+',
  '-',
  '*',
  '/',
  '^',
  '&',
  '=',
  '<',
  '>',
  '%',
  '(',
  ')',
  ',',
  ';',
  ':',
  '!',
  '{',
  '}',
];

/**
 * [sheets]: the workbook's sheet names. One written without quotes before "!" is read even when
 * it has characters a bare name can't ("sk-test-runs!B2:B5" for a shared sk-test-runs.csv: the
 * model wrote that, and it failed as "sk is not a column").
 */
function tokenize(src: string, sheets: string[] = []): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const named = sheets
    .filter((n) => n && !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n))
    .sort((x, y) => y.length - x.length);
  const s = src.trim().replace(/^=/, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      let v = '';
      i++;
      while (i < s.length) {
        if (s[i] === '"') {
          if (s[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          break;
        }
        v += s[i++];
      }
      if (i >= s.length) throw new FormulaError('a text in quotes is not closed');
      i++;
      out.push({ t: 'str', v });
      continue;
    }
    if (c === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) throw new FormulaError('a [column name] is not closed');
      out.push({ t: 'col', v: s.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0 || s[end + 1] !== '!')
        throw new FormulaError("a 'sheet name' must be followed by !");
      out.push({ t: 'sheet', v: s.slice(i + 1, end) });
      i = end + 2;
      continue;
    }
    const sheet = named.find(
      (n) => s[i + n.length] === '!' && s.slice(i, i + n.length).toLowerCase() === n.toLowerCase(),
    );
    if (sheet) {
      out.push({ t: 'sheet', v: sheet });
      i += sheet.length + 1;
      continue;
    }
    const num = /^(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i));
    if (num && !/[A-Za-z_]/.test(s[i + num[0].length] ?? '')) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[$A-Za-z_\\][$A-Za-z0-9_.]*/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      if (s[i] === '!') {
        out.push({ t: 'sheet', v: id[0] });
        i++;
      } else out.push({ t: 'id', v: id[0] });
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (!op) throw new FormulaError(`"${c}" can't be used in a formula`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

// --- Syntax tree ---

type Node =
  | { k: 'lit'; v: Scalar }
  | { k: 'name'; name: string; sheet?: string }
  | { k: 'col'; name: string; sheet?: string }
  | { k: 'cell'; col: number; row: number; sheet?: string; rowFixed?: boolean }
  | { k: 'range'; c1: number; c2: number; r1: number | null; r2: number | null; sheet?: string }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'array'; rows: Node[][] };

const CELL = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
const COLS = /^\$?([A-Za-z]{1,3})$/;

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  isOp(v: string) {
    const t = this.peek();
    return t?.t === 'op' && t.v === v;
  }
  expect(v: string) {
    if (!this.isOp(v)) {
      const t = this.peek();
      throw new FormulaError(
        `expected "${v}"${t ? ` before "${'v' in t ? t.v : ''}"` : ' at the end'}`,
      );
    }
    this.i++;
  }
  parse(): Node {
    const n = this.compare();
    if (this.i < this.toks.length) {
      const t = this.toks[this.i];
      throw new FormulaError(`unexpected "${'v' in t ? t.v : ''}"`);
    }
    return n;
  }
  compare(): Node {
    let a = this.concat();
    for (;;) {
      const t = this.peek();
      if (t?.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        this.i++;
        a = { k: 'bin', op: t.v, a, b: this.concat() };
      } else return a;
    }
  }
  concat(): Node {
    let a = this.add();
    while (this.isOp('&')) {
      this.i++;
      a = { k: 'bin', op: '&', a, b: this.add() };
    }
    return a;
  }
  add(): Node {
    let a = this.mul();
    for (;;) {
      const t = this.peek();
      if (t?.t === 'op' && (t.v === '+' || t.v === '-')) {
        this.i++;
        a = { k: 'bin', op: t.v, a, b: this.mul() };
      } else return a;
    }
  }
  mul(): Node {
    let a = this.pow();
    for (;;) {
      const t = this.peek();
      if (t?.t === 'op' && (t.v === '*' || t.v === '/')) {
        this.i++;
        a = { k: 'bin', op: t.v, a, b: this.pow() };
      } else return a;
    }
  }
  pow(): Node {
    let a = this.unary();
    while (this.isOp('^')) {
      this.i++;
      a = { k: 'bin', op: '^', a, b: this.unary() };
    }
    return a;
  }
  unary(): Node {
    const t = this.peek();
    if (t?.t === 'op' && (t.v === '-' || t.v === '+')) {
      this.i++;
      return { k: 'un', op: t.v, a: this.unary() };
    }
    let a = this.primary();
    while (this.isOp('%')) {
      this.i++;
      a = { k: 'un', op: '%', a };
    }
    return a;
  }
  args(): Node[] {
    this.expect('(');
    const out: Node[] = [];
    if (this.isOp(')')) {
      this.i++;
      return out;
    }
    for (;;) {
      // An argument left out (=IF(x,,1)) is empty.
      if (this.isOp(',') || this.isOp(';') || this.isOp(')')) out.push({ k: 'lit', v: null });
      else out.push(this.compare());
      if (this.isOp(',') || this.isOp(';')) {
        this.i++;
        continue;
      }
      this.expect(')');
      return out;
    }
  }
  primary(): Node {
    const t = this.peek();
    if (!t) throw new FormulaError('the formula ends too soon');
    this.i++;
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'col') return { k: 'col', name: t.v };
    if (t.t === 'sheet') {
      const n = this.primary();
      if (n.k === 'col' || n.k === 'name' || n.k === 'cell' || n.k === 'range')
        return { ...n, sheet: t.v } as Node;
      throw new FormulaError(`after ${t.v}! there must be a column or cells`);
    }
    if (t.t === 'op') {
      if (t.v === '(') {
        const n = this.compare();
        this.expect(')');
        return n;
      }
      if (t.v === '{') return this.arrayLit();
      throw new FormulaError(`unexpected "${t.v}"`);
    }
    // An identifier: a function, a cell or range, TRUE/FALSE, or a name.
    const id = t.v;
    if (this.isOp('(')) return { k: 'call', name: id.toUpperCase(), args: this.args() };
    const up = id.toUpperCase();
    if (up === 'TRUE' || up === 'FALSE') return { k: 'lit', v: up === 'TRUE' };
    const cell = CELL.exec(id);
    const cols = COLS.exec(id);
    if (this.isOp(':') && (cell || cols)) {
      this.i++;
      const u = this.peek();
      const other = u?.t === 'id' ? u.v : u?.t === 'num' ? String(u.v) : '';
      this.i++;
      const c2 = CELL.exec(other);
      const k2 = COLS.exec(other);
      if (cell && c2)
        return {
          k: 'range',
          c1: colIndex(cell[1]),
          r1: Number(cell[2]) - 1,
          c2: colIndex(c2[1]),
          r2: Number(c2[2]) - 1,
        };
      if (cols && k2)
        return { k: 'range', c1: colIndex(cols[1]), c2: colIndex(k2[1]), r1: null, r2: null };
      throw new FormulaError(`"${id}:${other}" is not a range (use C:C or A2:C10)`);
    }
    if (cell)
      return {
        k: 'cell',
        col: colIndex(cell[1]),
        row: Number(cell[2]) - 1,
        name: id,
        rowFixed: /\$\d/.test(id),
      } as Node;
    return { k: 'name', name: id };
  }
  arrayLit(): Node {
    const rows: Node[][] = [[]];
    for (;;) {
      rows[rows.length - 1].push(this.unary());
      if (this.isOp(',')) {
        this.i++;
        continue;
      }
      if (this.isOp(';')) {
        this.i++;
        rows.push([]);
        continue;
      }
      this.expect('}');
      if (rows.some((r) => r.length !== rows[0].length))
        throw new FormulaError('every row of an {array} needs the same number of values');
      return { k: 'array', rows };
    }
  }
}

export function parseFormula(src: string, sheets: string[] = []): Node {
  if (src.length > FORMULA_LIMITS.length) throw new FormulaError('the formula is too long');
  const toks = tokenize(src, sheets);
  if (!toks.length) throw new FormulaError('the formula is empty');
  return new Parser(toks).parse();
}

// --- Evaluation ---

export type FormulaContext = {
  sheets: Sheet[];
  /** The sheet bare columns and cells refer to. */
  sheet: number;
  /** Today, for TODAY() and NOW() (ms). */
  now: number;
};

type Env = {
  ctx: FormulaContext;
  tables: Map<number, Table>;
  vars: Map<string, Value>;
  steps: number;
  depth: number;
  /** When it started (ms), and the step count at the last clock check. */
  t0: number;
  checked: number;
};

const TOO_LONG = 'the formula takes too long to work out';

function step(env: Env, n = 1) {
  env.steps += n;
  if (env.steps > FORMULA_LIMITS.steps) throw new FormulaError(TOO_LONG);
  if (env.steps - env.checked > 20_000) {
    env.checked = env.steps;
    if (Date.now() - env.t0 > FORMULA_LIMITS.ms) throw new FormulaError(TOO_LONG);
  }
}

function tableFor(env: Env, sheet?: string): Table {
  let idx = env.ctx.sheet;
  if (sheet != null) {
    idx = env.ctx.sheets.findIndex((s) => s.name.toLowerCase() === sheet.toLowerCase());
    if (idx < 0)
      throw new FormulaError(
        `there is no sheet "${sheet}" (sheets: ${env.ctx.sheets.map((s) => s.name).join(', ')})`,
      );
  }
  let t = env.tables.get(idx);
  if (!t) {
    t = tableOf(env.ctx.sheets[idx]);
    env.tables.set(idx, t);
  }
  return t;
}

const normHeader = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .trim();

/** The column called [name] (its header, or its letter), or -1. */
export function findColumn(t: Table, name: string): number {
  const n = normHeader(name);
  const i = t.headers.findIndex((h) => normHeader(h) === n);
  if (i >= 0) return i;
  const byLetter = /^[A-Za-z]{1,3}$/.test(name) ? colIndex(name) : -1;
  return byLetter >= 0 && byLetter < t.width ? byLetter : -1;
}

function columnsList(t: Table): string {
  return Array.from({ length: t.width }, (_, c) =>
    t.headers[c] ? `[${t.headers[c]}]` : `${colName(c)}:${colName(c)}`,
  ).join(', ');
}

function columnArr(t: Table, c1: number, c2: number): Arr {
  const rows = t.sheet.rows.length - t.first;
  const cols = c2 - c1 + 1;
  const data: Scalar[] = new Array(Math.max(0, rows) * cols);
  for (let r = 0; r < rows; r++) {
    const row = t.sheet.rows[t.first + r];
    for (let c = 0; c < cols; c++) data[r * cols + c] = row[c1 + c] ?? null;
  }
  const headers = Array.from({ length: cols }, (_, c) => t.headers[c1 + c] || colName(c1 + c));
  const rowNos = Array.from({ length: rows }, (_, r) => t.first + r + 1);
  return new Arr(rows, cols, data, headers, rowNos);
}

function rangeArr(t: Table, c1: number, r1: number, c2: number, r2: number): Arr {
  [c1, c2] = [Math.min(c1, c2), Math.max(c1, c2)];
  [r1, r2] = [Math.min(r1, r2), Math.max(r1, r2)];
  const rows = r2 - r1 + 1;
  const cols = c2 - c1 + 1;
  if (rows * cols > FORMULA_LIMITS.cells) throw new FormulaError('that range is too big');
  const data: Scalar[] = new Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const row = t.sheet.rows[r1 + r] ?? [];
    for (let c = 0; c < cols; c++) data[r * cols + c] = row[c1 + c] ?? null;
  }
  return new Arr(
    rows,
    cols,
    data,
    undefined,
    Array.from({ length: rows }, (_, r) => r1 + r + 1),
  );
}

function evaluate(n: Node, env: Env): Value {
  step(env);
  switch (n.k) {
    case 'lit':
      return n.v;
    case 'col': {
      const t = tableFor(env, n.sheet);
      const c = findColumn(t, n.name);
      if (c < 0)
        throw new FormulaError(`there is no column [${n.name}] (columns: ${columnsList(t)})`);
      return columnArr(t, c, c);
    }
    case 'name': {
      const v = env.vars.get(n.name.toUpperCase());
      if (v !== undefined && !n.sheet) return v;
      const t = tableFor(env, n.sheet);
      const c = t.headers.findIndex((h) => normHeader(h) === normHeader(n.name));
      if (c >= 0) return columnArr(t, c, c);
      const f = FUNCS[n.name.toUpperCase()];
      if (f && !n.sheet) return new Fn(n.name.toUpperCase(), (args) => f(args, env));
      throw new FormulaError(
        `"${n.name}" is not a column, name or function (columns: ${columnsList(t)})`,
      );
    }
    case 'cell': {
      const t = tableFor(env, n.sheet);
      return t.sheet.rows[n.row]?.[n.col] ?? null;
    }
    case 'range': {
      const t = tableFor(env, n.sheet);
      if (n.r1 == null || n.r2 == null)
        return columnArr(t, Math.min(n.c1, n.c2), Math.max(n.c1, n.c2));
      return rangeArr(t, n.c1, n.r1, n.c2, n.r2);
    }
    case 'array': {
      const rows = n.rows.length;
      const cols = n.rows[0].length;
      const data = n.rows.flat().map((x) => scalarOf(evaluate(x, env)));
      return new Arr(rows, cols, data);
    }
    case 'un': {
      const a = evaluate(n.a, env);
      if (n.op === '-') return lift([a], ([x]) => neg(x), env);
      if (n.op === '%')
        return lift([a], ([x]) => withNum(x, (v) => Number((v / 100).toPrecision(15))), env);
      return a;
    }
    case 'bin':
      return lift([evaluate(n.a, env), evaluate(n.b, env)], ([x, y]) => binary(n.op, x, y), env);
    case 'call': {
      const lazy = LAZY[n.name];
      if (lazy) return lazy(n.args, env);
      const v = env.vars.get(n.name);
      if (v instanceof Fn)
        return callFn(
          v,
          n.args.map((a) => evaluate(a, env)),
          env,
        );
      const f = FUNCS[n.name] ?? FUNCS[n.name.replace(/^_XLFN\./, '')];
      if (!f) throw new FormulaError(`there is no function ${n.name}`);
      const args = n.args.map((a) => evaluate(a, env));
      // A function looks at every cell it is given: count them against the work limit.
      step(
        env,
        args.reduce<number>((k, a) => k + (a instanceof Arr ? a.rows * a.cols : 0), 0),
      );
      return f(args, env);
    }
  }
}

function callFn(f: Value, args: Value[], env: Env): Value {
  if (!(f instanceof Fn)) throw new FormulaError('expected a function, like SUM or LAMBDA(x, x*2)');
  env.depth++;
  if (env.depth > FORMULA_LIMITS.depth) throw new FormulaError('the formula goes too deep');
  try {
    return f.call(args);
  } finally {
    env.depth--;
  }
}

// --- Conversions ---

const isErr = (v: unknown): v is XErr => v instanceof XErr;

function scalarOf(v: Value): Scalar {
  if (v instanceof Arr) return v.rows && v.cols ? v.at(0, 0) : null;
  if (v instanceof Fn) return new XErr('#VALUE!', 'a function is not a value');
  return v;
}

/** A number from a value, or an error. */
function num(v: Scalar): number | XErr {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof XDate) return v.serial;
  if (v instanceof XErr) return v;
  const n = parseNumber(v);
  if (n != null) return n;
  const d = parseDate(v);
  if (d) return d.serial;
  return new XErr('#VALUE!', `"${v}" is not a number`);
}

function withNum(v: Scalar, f: (n: number) => Scalar): Scalar {
  const n = num(v);
  return isErr(n) ? n : f(n);
}

function text(v: Scalar): string {
  if (typeof v === 'number') return formatNumber(v);
  return formatValue(v);
}

function bool(v: Scalar): boolean | XErr {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  if (typeof v === 'number') return v !== 0;
  if (v instanceof XDate) return true;
  if (v instanceof XErr) return v;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return new XErr('#VALUE!', `"${v}" is not TRUE or FALSE`);
}

/** Decimal places of a number as written (0.25 → 2), or -1 when it isn't short. */
function decimals(n: number): number {
  if (Number.isInteger(n)) return Math.abs(n) < 1e21 ? 0 : -1;
  const s = formatNumber(n);
  if (/e/i.test(s)) return -1;
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** A sum of decimals with no floating-point error (0.1 + 0.2 is 0.3). */
export function exactSum(xs: number[]): number {
  let d = 0;
  for (const x of xs) {
    const k = decimals(x);
    if (k < 0 || k > 10) return xs.reduce((a, b) => a + b, 0);
    if (k > d) d = k;
  }
  const scale = 10 ** d;
  let total = 0;
  for (const x of xs) total += Math.round(x * scale);
  if (!Number.isSafeInteger(total)) return xs.reduce((a, b) => a + b, 0);
  return total / scale;
}

function roundTo(x: number, d: number): number {
  if (Number.isInteger(x)) return x;
  if (d < 0 || d > 15 || !Number.isFinite(x) || Math.abs(x) >= 1e15) return x;
  return Number(x.toFixed(d));
}

function neg(x: Scalar): Scalar {
  return withNum(x, (v) => -v);
}

function cmp(a: Scalar, b: Scalar): number {
  const rank = (v: Scalar) =>
    v == null
      ? -1
      : typeof v === 'number' || v instanceof XDate
        ? 0
        : typeof v === 'string'
          ? 1
          : typeof v === 'boolean'
            ? 2
            : 3;
  // An empty cell compares as 0 against a number and "" against text.
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const x = a instanceof XDate ? a.serial : (a as number);
    const y = b instanceof XDate ? b.serial : (b as number);
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (ra === 1) {
    const x = (a as string).toLowerCase();
    const y = (b as string).toLowerCase();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return Number(a) - Number(b);
}

function binary(op: string, x: Scalar, y: Scalar): Scalar {
  if (isErr(x)) return x;
  if (isErr(y)) return y;
  switch (op) {
    case '&':
      return text(x) + text(y);
    case '=':
      return cmp(x, y) === 0;
    case '<>':
      return cmp(x, y) !== 0;
    case '<':
      return cmp(x, y) < 0;
    case '>':
      return cmp(x, y) > 0;
    case '<=':
      return cmp(x, y) <= 0;
    case '>=':
      return cmp(x, y) >= 0;
  }
  const a = num(x);
  const b = num(y);
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  const da = x instanceof XDate;
  const db = y instanceof XDate;
  switch (op) {
    case '+': {
      const r = roundTo(a + b, Math.max(decimals(a), decimals(b)));
      return da !== db ? new XDate(r) : r;
    }
    case '-': {
      const r = roundTo(a - b, Math.max(decimals(a), decimals(b)));
      return da && !db ? new XDate(r) : r;
    }
    case '*': {
      const d = decimals(a) + decimals(b);
      return roundTo(a * b, decimals(a) < 0 || decimals(b) < 0 ? -1 : d);
    }
    case '/':
      return b === 0 ? new XErr('#DIV/0!', 'division by zero') : a / b;
    case '^': {
      const r = a ** b;
      return Number.isFinite(r) ? r : new XErr('#NUM!');
    }
  }
  return new XErr('#VALUE!');
}

/** Applies [f] element by element when any argument is an array (Excel's broadcasting). */
function lift(args: Value[], f: (xs: Scalar[]) => Scalar, env: Env): Value {
  const arrs = args.filter((a): a is Arr => a instanceof Arr);
  if (args.some((a) => a instanceof Fn))
    throw new FormulaError('a function name was used as a value');
  if (!arrs.length) return f(args as Scalar[]);
  const rows = Math.max(...arrs.map((a) => a.rows));
  const cols = Math.max(...arrs.map((a) => a.cols));
  if (rows * cols > FORMULA_LIMITS.cells) throw new FormulaError('the result is too big');
  step(env, rows * cols);
  const data: Scalar[] = new Array(rows * cols);
  const xs: Scalar[] = new Array(args.length);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < args.length; k++) {
        const a = args[k];
        if (a instanceof Arr) {
          const rr = a.rows === 1 ? 0 : r;
          const cc = a.cols === 1 ? 0 : c;
          xs[k] = rr < a.rows && cc < a.cols ? a.at(rr, cc) : new XErr('#N/A');
        } else xs[k] = a as Scalar;
      }
      data[r * cols + c] = f(xs);
    }
  const like = arrs.find((a) => a.rows === rows);
  return new Arr(rows, cols, data, undefined, like?.rowNos);
}

/** Every value in the arguments, arrays flattened. */
function flat(args: Value[]): { v: Scalar; direct: boolean }[] {
  const out: { v: Scalar; direct: boolean }[] = [];
  for (const a of args) {
    if (a instanceof Arr) for (const v of a.data) out.push({ v, direct: false });
    else if (a instanceof Fn) throw new FormulaError('a function name was used as a value');
    else out.push({ v: a, direct: true });
  }
  return out;
}

/** The numbers among the arguments: in ranges only real numbers and dates count (as in Excel). */
function numbers(args: Value[]): number[] | XErr {
  const out: number[] = [];
  for (const { v, direct } of flat(args)) {
    if (isErr(v)) return v;
    if (typeof v === 'number') out.push(v);
    else if (v instanceof XDate) out.push(v.serial);
    else if (direct && v != null) {
      const n = num(v);
      if (isErr(n)) return n;
      out.push(n);
    }
  }
  return out;
}

const arrOf = (v: Value): Arr =>
  v instanceof Arr
    ? v
    : v instanceof Fn
      ? (() => {
          throw new FormulaError('a function name was used as a value');
        })()
      : new Arr(1, 1, [v]);

const int = (v: Value, what: string): number => {
  const n = num(scalarOf(v));
  if (isErr(n)) throw new FormulaError(`${what} must be a number`);
  return Math.trunc(n);
};

// --- Criteria (SUMIF, COUNTIFS…) ---

type Test = (v: Scalar) => boolean;

function wildcard(p: string): RegExp {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '~' && i + 1 < p.length) re += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (c === '*') re += '[\\s\\S]*';
    else if (c === '?') re += '[\\s\\S]';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export function criterion(c: Scalar): Test {
  if (typeof c === 'number' || c instanceof XDate || typeof c === 'boolean')
    return (v) => v != null && cmp(v, c) === 0;
  if (c == null) return (v) => v == null || v === '';
  if (isErr(c)) return (v) => isErr(v) && v.code === c.code;
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(c)!;
  const op = m[1] ?? '=';
  const raw = m[2];
  const n = parseNumber(raw);
  const d = n == null ? parseDate(raw) : null;
  const target: Scalar = n ?? d ?? raw;
  if (raw === '') {
    if (op === '=') return (v) => v == null || v === '';
    if (op === '<>') return (v) => v != null && v !== '';
  }
  if (typeof target === 'string' && (op === '=' || op === '<>')) {
    const re = /[*?~]/.test(target) ? wildcard(target) : null;
    const t = target.toLowerCase();
    const eq = (v: Scalar) =>
      re ? re.test(text(v)) : typeof v === 'string' && v.toLowerCase() === t;
    return op === '=' ? eq : (v) => !eq(v);
  }
  const numeric = typeof target !== 'string';
  return (v) => {
    if (v == null || v === '') return op === '<>';
    if (numeric && !(typeof v === 'number' || v instanceof XDate)) {
      const k = typeof v === 'string' ? parseNumber(v) : null;
      if (k == null) return op === '<>';
      v = k;
    }
    if (!numeric && typeof v !== 'string') return op === '<>';
    const r = cmp(v, target);
    switch (op) {
      case '=':
        return r === 0;
      case '<>':
        return r !== 0;
      case '<':
        return r < 0;
      case '>':
        return r > 0;
      case '<=':
        return r <= 0;
      default:
        return r >= 0;
    }
  };
}

/**
 * The rows matching all (range, criterion) pairs. A criterion that is an array (UNIQUE of a
 * column, say) gives one answer per value: [each] is then called per value.
 */
function ifs(pairs: Value[], each: (match: (i: number) => boolean) => Scalar, env: Env): Value {
  if (pairs.length % 2) throw new FormulaError('each range needs its criterion');
  const ranges: Arr[] = [];
  const crits: Value[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    ranges.push(arrOf(pairs[i]));
    crits.push(pairs[i + 1]);
  }
  const n = ranges[0]?.data.length ?? 0;
  if (ranges.some((r) => r.data.length !== n))
    throw new FormulaError('the ranges must all be the same size');
  return lift(
    crits,
    (cs) => {
      const tests = cs.map(criterion);
      step(env, n * tests.length);
      return each((i) => tests.every((t, k) => t(ranges[k].data[i])));
    },
    env,
  );
}

// --- Statistics ---

const mean = (xs: number[]) => exactSum(xs) / xs.length;

function variance(xs: number[], sample: boolean): number | XErr {
  if (xs.length < (sample ? 2 : 1)) return new XErr('#DIV/0!', 'not enough numbers');
  const m = mean(xs);
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0);
  return ss / (xs.length - (sample ? 1 : 0));
}

function percentile(xs: number[], p: number): number | XErr {
  if (!xs.length || p < 0 || p > 1) return new XErr('#NUM!');
  const s = [...xs].sort((a, b) => a - b);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
}

function agg(f: (xs: number[]) => Scalar) {
  return (args: Value[]) => {
    const xs = numbers(args);
    return isErr(xs) ? xs : f(xs);
  };
}

// --- Dates ---

function ymd(serial: number) {
  const d = new Date(msFromSerial(Math.floor(serial + 1e-9)));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() };
}

const dateArg = (v: Scalar): number | XErr => {
  if (typeof v === 'string') {
    const d = parseDate(v);
    if (d) return d.serial;
  }
  return num(v);
};

function edate(serial: number, months: number, endOfMonth: boolean): XDate {
  const { y, m, d } = ymd(serial);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return new XDate(serialOf(ny, nm, endOfMonth ? last : Math.min(d, last)));
}

function datedif(a: number, b: number, unit: string): Scalar {
  if (b < a) return new XErr('#NUM!', 'the end is before the start');
  const s = ymd(a);
  const e = ymd(b);
  let months = (e.y - s.y) * 12 + (e.m - s.m) - (e.d < s.d ? 1 : 0);
  switch (unit.toUpperCase()) {
    case 'D':
      return Math.floor(b) - Math.floor(a);
    case 'M':
      return months;
    case 'Y':
      return Math.floor(months / 12);
    case 'YM':
      return months % 12;
    case 'MD': {
      const prev = edate(a, months, false).serial;
      return Math.floor(b) - Math.floor(prev);
    }
    case 'YD': {
      const years = Math.floor(months / 12);
      months = years * 12;
      return Math.floor(b) - Math.floor(edate(a, months, false).serial);
    }
  }
  return new XErr('#NUM!', 'DATEDIF unit is "d", "m", "y", "ym", "md" or "yd"');
}

/** TEXT(value, format): dates (yyyy, mmm, dd, dddd, hh:mm) and numbers (0.00, #,##0, 0%). */
export function formatText(v: Scalar, fmt: string): string {
  if (v instanceof XErr) return v.code;
  const lower = fmt.toLowerCase();
  const isDate = v instanceof XDate || (/[dy]|mmm|hh/.test(lower) && !/[0#]/.test(lower));
  if (isDate) {
    const n = dateArg(v);
    if (isErr(n)) return text(v);
    const { y, m, d, wd } = ymd(n);
    const mins = Math.round((n - Math.floor(n)) * 1440);
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const pad = (x: number) => String(x).padStart(2, '0');
    const hasTime = /h/i.test(fmt);
    return fmt.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|AM\/PM|"[^"]*"/gi, (tok) => {
      const t = tok.toLowerCase();
      if (tok.startsWith('"')) return tok.slice(1, -1);
      switch (t) {
        case 'yyyy':
          return String(y);
        case 'yy':
          return pad(y % 100);
        case 'mmmm':
          return new Date(Date.UTC(2000, m - 1, 1)).toLocaleString('en', {
            month: 'long',
            timeZone: 'UTC',
          });
        case 'mmm':
          return MONTH_NAMES[m - 1];
        case 'mm':
          return hasTime && /h.*mm|mm.*s/i.test(fmt) ? pad(mins % 60) : pad(m);
        case 'm':
          return String(m);
        case 'dddd':
          return DAYS[wd];
        case 'ddd':
          return DAYS[wd].slice(0, 3);
        case 'dd':
          return pad(d);
        case 'd':
          return String(d);
        case 'hh':
          return pad(Math.floor(mins / 60));
        case 'h':
          return String(Math.floor(mins / 60));
        case 'ss':
          return '00';
        default:
          return tok;
      }
    });
  }
  const n = num(v);
  if (isErr(n)) return text(v);
  const pct = fmt.includes('%');
  const x = pct ? n * 100 : n;
  const dec = /\.([0#]+)/.exec(fmt)?.[1].length ?? 0;
  const grouped = /#,##|0,0/.test(fmt);
  let s = Math.abs(x).toFixed(dec);
  if (grouped) s = s.replace(/^(\d+)/, (w) => w.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  const prefix = /^[^0#.,%]*/.exec(fmt)?.[0].replace(/"/g, '') ?? '';
  return `${x < 0 ? '-' : ''}${prefix}${s}${pct ? '%' : ''}`;
}

// --- Lookups ---

function matchIndex(v: Scalar, list: Scalar[], mode: number, fromEnd = false): number {
  // mode 0 exact (wildcards with 2), -1 exact or next smaller, 1 exact or next larger.
  if (mode === 2 && typeof v === 'string') {
    const re = wildcard(v);
    const idx = list.map((x, i) => i);
    for (const i of fromEnd ? idx.reverse() : idx) if (re.test(text(list[i]))) return i;
    return -1;
  }
  let best = -1;
  for (let k = 0; k < list.length; k++) {
    const i = fromEnd ? list.length - 1 - k : k;
    const x = list[i];
    if (x == null) continue;
    const r = cmp(x, v);
    if (r === 0 && (typeof x === typeof v || (typeof x !== 'string' && typeof v !== 'string')))
      return i;
    if (mode === -1 && r < 0 && (best < 0 || cmp(x, list[best]) > 0)) best = i;
    if (mode === 1 && r > 0 && (best < 0 || cmp(x, list[best]) < 0)) best = i;
  }
  return best;
}

function rowOf(a: Arr, r: number): Scalar[] {
  return a.data.slice(r * a.cols, (r + 1) * a.cols);
}

function pickRows(a: Arr, idx: number[]): Arr {
  const data: Scalar[] = [];
  for (const r of idx) data.push(...rowOf(a, r));
  return new Arr(
    idx.length,
    a.cols,
    data,
    a.headers,
    a.rowNos ? idx.map((r) => a.rowNos![r]) : undefined,
  );
}

function keyOf(vals: Scalar[]): string {
  return vals
    .map((v) =>
      v instanceof XDate
        ? `d${v.serial}`
        : typeof v === 'string'
          ? `s${v.toLowerCase()}`
          : `${typeof v}${String(v)}`,
    )
    .join('\u0001');
}

// --- Functions ---

type Impl = (args: Value[], env: Env) => Value;

const s0 = (args: Value[], i: number): Scalar => (i < args.length ? scalarOf(args[i]) : null);

/** A function of single values, applied element by element over arrays. */
const each =
  (f: (...xs: Scalar[]) => Scalar, min = 1, max = min): Impl =>
  (args, env) => {
    if (args.length < min || args.length > max)
      throw new FormulaError(
        `takes ${min === max ? min : `${min} to ${max}`} argument${max === 1 ? '' : 's'}`,
      );
    return lift(
      args,
      (xs) => {
        for (const x of xs) if (isErr(x)) return x;
        return f(...xs);
      },
      env,
    );
  };

const mathFn = (f: (x: number, y: number) => number, min = 1, max = 1) =>
  each(
    (a, b) => {
      const x = num(a);
      const y = b === undefined ? 0 : num(b);
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      const r = f(x, y);
      return Number.isFinite(r) ? r : new XErr('#NUM!');
    },
    min,
    max,
  );

const round = (x: number, d: number, mode: 'near' | 'up' | 'down') => {
  const k = 10 ** Math.trunc(d);
  const v = Number((Math.abs(x) * k).toPrecision(15));
  const r = mode === 'near' ? Math.round(v) : mode === 'up' ? Math.ceil(v) : Math.floor(v);
  return (Math.sign(x) * r) / k;
};

const strFn = (f: (...xs: string[]) => Scalar, min = 1, max = min) =>
  each((...xs) => f(...xs.map((x) => (x == null ? '' : text(x)))), min, max);

const sortRows = (a: Arr, keys: { col: Scalar[]; desc: boolean }[]): Arr => {
  const idx = Array.from({ length: a.rows }, (_, i) => i);
  idx.sort((x, y) => {
    for (const k of keys) {
      const r = cmp(k.col[x], k.col[y]);
      if (r) return k.desc ? -r : r;
    }
    return x - y;
  });
  return pickRows(a, idx);
};

function columnOf(a: Arr, c: number): Scalar[] {
  return Array.from({ length: a.rows }, (_, r) => a.at(r, c));
}

function aggregateWith(f: Value, values: Arr, env: Env): Scalar {
  return scalarOf(callFn(f, [values], env));
}

function fnName(f: Value): string {
  return f instanceof Fn ? f.name : 'value';
}

const FUNCS: Record<string, Impl> = {
  SUM: agg((xs) => exactSum(xs)),
  AVERAGE: agg((xs) => (xs.length ? mean(xs) : new XErr('#DIV/0!', 'no numbers to average'))),
  COUNT: agg((xs) => xs.length),
  COUNTA: (args) => flat(args).filter(({ v }) => v != null && v !== '').length,
  COUNTBLANK: (args) => flat(args).filter(({ v }) => v == null || v === '').length,
  MIN: agg((xs) => (xs.length ? Math.min(...xs) : 0)),
  MAX: agg((xs) => (xs.length ? Math.max(...xs) : 0)),
  MEDIAN: agg((xs) => percentile(xs, 0.5)),
  PRODUCT: agg((xs) => xs.reduce((a, b) => a * b, 1)),
  'STDEV.S': agg((xs) => {
    const v = variance(xs, true);
    return isErr(v) ? v : Math.sqrt(v);
  }),
  'STDEV.P': agg((xs) => {
    const v = variance(xs, false);
    return isErr(v) ? v : Math.sqrt(v);
  }),
  'VAR.S': agg((xs) => variance(xs, true)),
  'VAR.P': agg((xs) => variance(xs, false)),
  'MODE.SNGL': agg((xs) => {
    const counts = new Map<number, number>();
    let best: number | null = null;
    for (const x of xs) {
      const c = (counts.get(x) ?? 0) + 1;
      counts.set(x, c);
      if (c > 1 && (best == null || c > counts.get(best)!)) best = x;
    }
    return best ?? new XErr('#N/A', 'no number appears twice');
  }),
  LARGE: (args) => {
    const xs = numbers([args[0]]);
    const k = int(args[1], 'LARGE k');
    if (isErr(xs)) return xs;
    const s = [...xs].sort((a, b) => b - a);
    return k >= 1 && k <= s.length ? s[k - 1] : new XErr('#NUM!');
  },
  SMALL: (args) => {
    const xs = numbers([args[0]]);
    const k = int(args[1], 'SMALL k');
    if (isErr(xs)) return xs;
    const s = [...xs].sort((a, b) => a - b);
    return k >= 1 && k <= s.length ? s[k - 1] : new XErr('#NUM!');
  },
  'PERCENTILE.INC': (args) => {
    const xs = numbers([args[0]]);
    const p = num(s0(args, 1));
    if (isErr(xs)) return xs;
    return isErr(p) ? p : percentile(xs, p);
  },
  QUARTILE: (args) => {
    const xs = numbers([args[0]]);
    const q = int(args[1], 'QUARTILE');
    if (isErr(xs)) return xs;
    return percentile(xs, q / 4);
  },
  'RANK.EQ': (args, env) => {
    const xs = numbers([args[1]]);
    if (isErr(xs)) return xs;
    const asc = !!bool(s0(args, 2));
    return lift(
      [args[0]],
      ([v]) => {
        const n = num(v);
        if (isErr(n)) return n;
        if (!xs.includes(n)) return new XErr('#N/A', 'the value is not in the list');
        return 1 + xs.filter((x) => (asc ? x < n : x > n)).length;
      },
      env,
    );
  },
  SUMPRODUCT: (args) => {
    const arrs = args.map(arrOf);
    const n = arrs[0]?.data.length ?? 0;
    if (arrs.some((a) => a.data.length !== n))
      return new XErr('#VALUE!', 'the ranges must be the same size');
    const terms: number[] = [];
    for (let i = 0; i < n; i++) {
      let p = 1;
      for (const a of arrs) {
        const v = a.data[i];
        if (isErr(v)) return v;
        p *=
          typeof v === 'number'
            ? v
            : v instanceof XDate
              ? v.serial
              : typeof v === 'boolean'
                ? Number(v)
                : 0;
      }
      terms.push(p);
    }
    return exactSum(terms);
  },
  SUMIF: (args, env) => {
    const range = arrOf(args[0]);
    const sum = args[2] != null ? arrOf(args[2]) : range;
    return ifs([range, args[1]], (m) => sumWhere(sum, m), env);
  },
  SUMIFS: (args, env) => {
    const sum = arrOf(args[0]);
    return ifs(args.slice(1), (m) => sumWhere(sum, m), env);
  },
  COUNTIF: (args, env) => ifs(args, (m) => countWhere(arrOf(args[0]).data.length, m), env),
  COUNTIFS: (args, env) => ifs(args, (m) => countWhere(arrOf(args[0]).data.length, m), env),
  AVERAGEIF: (args, env) => {
    const range = arrOf(args[0]);
    const vals = args[2] != null ? arrOf(args[2]) : range;
    return ifs([range, args[1]], (m) => avgWhere(vals, m), env);
  },
  AVERAGEIFS: (args, env) => ifs(args.slice(1), (m) => avgWhere(arrOf(args[0]), m), env),
  MAXIFS: (args, env) =>
    ifs(
      args.slice(1),
      (m) => {
        const xs = pickNums(arrOf(args[0]), m);
        return xs.length ? Math.max(...xs) : 0;
      },
      env,
    ),
  MINIFS: (args, env) =>
    ifs(
      args.slice(1),
      (m) => {
        const xs = pickNums(arrOf(args[0]), m);
        return xs.length ? Math.min(...xs) : 0;
      },
      env,
    ),

  ROUND: mathFn((x, d) => round(x, d, 'near'), 1, 2),
  ROUNDUP: mathFn((x, d) => round(x, d, 'up'), 1, 2),
  ROUNDDOWN: mathFn((x, d) => round(x, d, 'down'), 1, 2),
  TRUNC: mathFn((x, d) => round(x, d, 'down'), 1, 2),
  INT: mathFn((x) => Math.floor(x)),
  ABS: mathFn((x) => Math.abs(x)),
  SIGN: mathFn((x) => Math.sign(x)),
  SQRT: mathFn((x) => (x < 0 ? NaN : Math.sqrt(x))),
  EXP: mathFn((x) => Math.exp(x)),
  LN: mathFn((x) => Math.log(x)),
  LOG10: mathFn((x) => Math.log10(x)),
  LOG: mathFn((x, b) => Math.log(x) / Math.log(b || 10), 1, 2),
  POWER: mathFn((x, y) => x ** y, 2, 2),
  MOD: each(
    (a, b) => {
      const x = num(a);
      const y = num(b);
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      if (y === 0) return new XErr('#DIV/0!');
      return roundTo(x - y * Math.floor(x / y), Math.max(decimals(x), decimals(y)));
    },
    2,
    2,
  ),
  CEILING: mathFn((x, s) => (s ? Math.ceil(Number((x / s).toPrecision(15))) * s : 0), 1, 2),
  FLOOR: mathFn((x, s) => (s ? Math.floor(Number((x / s).toPrecision(15))) * s : 0), 1, 2),
  PI: () => Math.PI,

  AND: (args) => {
    let r = true;
    for (const { v } of flat(args)) {
      if (v == null || v === '') continue;
      const b = bool(v);
      if (isErr(b)) return b;
      r &&= b;
    }
    return r;
  },
  OR: (args) => {
    let r = false;
    for (const { v } of flat(args)) {
      if (v == null || v === '') continue;
      const b = bool(v);
      if (isErr(b)) return b;
      r ||= b;
    }
    return r;
  },
  XOR: (args) => flat(args).filter(({ v }) => bool(v) === true).length % 2 === 1,
  NOT: each((a) => {
    const b = bool(a);
    return isErr(b) ? b : !b;
  }),
  ISBLANK: (args, env) => lift([args[0]], ([v]) => v == null, env),
  ISNUMBER: (args, env) =>
    lift([args[0]], ([v]) => typeof v === 'number' || v instanceof XDate, env),
  ISTEXT: (args, env) => lift([args[0]], ([v]) => typeof v === 'string', env),
  ISERROR: (args, env) => lift([args[0]], ([v]) => isErr(v), env),
  ISNA: (args, env) => lift([args[0]], ([v]) => isErr(v) && v.code === '#N/A', env),

  LEN: strFn((s) => s.length),
  LEFT: each((a, b) => text(a ?? '').slice(0, b == null ? 1 : Number(num(b))), 1, 2),
  RIGHT: each(
    (a, b) => {
      const s = text(a ?? '');
      const n = b == null ? 1 : Number(num(b));
      return n > 0 ? s.slice(-n) : '';
    },
    1,
    2,
  ),
  MID: each(
    (a, b, c) => {
      const start = Number(num(b));
      return text(a ?? '').slice(start - 1, start - 1 + Number(num(c)));
    },
    3,
    3,
  ),
  UPPER: strFn((s) => s.toUpperCase()),
  LOWER: strFn((s) => s.toLowerCase()),
  PROPER: strFn((s) =>
    s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, p, l: string) => p + l.toUpperCase()),
  ),
  TRIM: strFn((s) => s.replace(/\s+/g, ' ').trim()),
  SUBSTITUTE: strFn(
    (s, from, to, nth) => {
      if (!from) return s;
      if (!nth) return s.split(from).join(to);
      let k = 0;
      return s.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (m) =>
        ++k === Number(nth) ? to : m,
      );
    },
    3,
    4,
  ),
  FIND: strFn(
    (find, within, start) => {
      const i = within.indexOf(find, start ? Number(start) - 1 : 0);
      return i < 0 ? new XErr('#VALUE!', `"${find}" is not in the text`) : i + 1;
    },
    2,
    3,
  ),
  SEARCH: strFn(
    (find, within, start) => {
      const re = wildcard(`*${find}*`);
      const from = start ? Number(start) - 1 : 0;
      for (let i = from; i < within.length; i++)
        if (re.test(within.slice(i)) && wildcard(`${find}*`).test(within.slice(i))) return i + 1;
      return new XErr('#VALUE!', `"${find}" is not in the text`);
    },
    2,
    3,
  ),
  VALUE: each((a) => num(a)),
  EXACT: strFn((a, b) => a === b, 2, 2),
  REPT: each((a, b) => text(a ?? '').repeat(Math.max(0, Math.min(1000, Number(num(b))))), 2, 2),
  CONCAT: (args) =>
    flat(args)
      .map(({ v }) => (v == null ? '' : text(v)))
      .join(''),
  TEXTJOIN: (args) => {
    const delim = text(s0(args, 0) ?? '');
    const skipEmpty = bool(s0(args, 1)) === true;
    return flat(args.slice(2))
      .map(({ v }) => (v == null ? '' : text(v)))
      .filter((v) => !skipEmpty || v !== '')
      .join(delim);
  },
  TEXTBEFORE: strFn(
    (s, d) => {
      const i = s.indexOf(d);
      return i < 0 ? new XErr('#N/A') : s.slice(0, i);
    },
    2,
    2,
  ),
  TEXTAFTER: strFn(
    (s, d) => {
      const i = s.indexOf(d);
      return i < 0 ? new XErr('#N/A') : s.slice(i + d.length);
    },
    2,
    2,
  ),
  TEXT: each((v, f) => formatText(v, text(f ?? '')), 2, 2),

  DATE: each(
    (y, m, d) => {
      const ys = num(y);
      const ms = num(m);
      const ds = num(d);
      if (isErr(ys) || isErr(ms) || isErr(ds)) return new XErr('#VALUE!');
      return new XDate(serialFromMs(Date.UTC(ys < 1900 ? ys + 1900 : ys, ms - 1, ds)));
    },
    3,
    3,
  ),
  TODAY: (_a, env) =>
    new XDate(
      Math.floor(serialFromMs(env.ctx.now - new Date(env.ctx.now).getTimezoneOffset() * 60_000)),
    ),
  NOW: (_a, env) =>
    new XDate(serialFromMs(env.ctx.now - new Date(env.ctx.now).getTimezoneOffset() * 60_000)),
  YEAR: each((v) => withDate(v, (s) => ymd(s).y)),
  MONTH: each((v) => withDate(v, (s) => ymd(s).m)),
  DAY: each((v) => withDate(v, (s) => ymd(s).d)),
  HOUR: each((v) => withDate(v, (s) => Math.floor(Math.round((s % 1) * 1440) / 60))),
  MINUTE: each((v) => withDate(v, (s) => Math.round((s % 1) * 1440) % 60)),
  WEEKDAY: each(
    (v, t) =>
      withDate(v, (s) => {
        const wd = ymd(s).wd;
        const type = t == null ? 1 : Number(num(t));
        return type === 2 ? ((wd + 6) % 7) + 1 : type === 3 ? (wd + 6) % 7 : wd + 1;
      }),
    1,
    2,
  ),
  ISOWEEKNUM: each((v) => withDate(v, isoWeek)),
  WEEKNUM: each(
    (v) =>
      withDate(v, (s) => {
        const { y } = ymd(s);
        const jan1 = serialOf(y, 1, 1);
        return Math.floor((Math.floor(s) - jan1 + ymd(jan1).wd) / 7) + 1;
      }),
    1,
    2,
  ),
  EDATE: each((v, n) => withDate(v, (s) => edate(s, Number(num(n)), false)), 2, 2),
  EOMONTH: each((v, n) => withDate(v, (s) => edate(s, Number(num(n)), true)), 2, 2),
  DAYS: each(
    (e, s) => {
      const a = dateArg(e);
      const b = dateArg(s);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      return Math.floor(a) - Math.floor(b);
    },
    2,
    2,
  ),
  DATEDIF: each(
    (s, e, u) => {
      const a = dateArg(s);
      const b = dateArg(e);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      return datedif(a, b, text(u ?? 'd'));
    },
    3,
    3,
  ),
  NETWORKDAYS: each(
    (s, e) => {
      const a = dateArg(s);
      const b = dateArg(e);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      const [lo, hi] = a <= b ? [Math.floor(a), Math.floor(b)] : [Math.floor(b), Math.floor(a)];
      if (hi - lo > 100_000) return new XErr('#NUM!');
      let n = 0;
      for (let d = lo; d <= hi; d++) {
        const wd = ymd(d).wd;
        if (wd !== 0 && wd !== 6) n++;
      }
      return a <= b ? n : -n;
    },
    2,
    2,
  ),
  DATEVALUE: each((v) =>
    typeof v === 'string' ? (parseDate(v) ?? new XErr('#VALUE!', `"${v}" is not a date`)) : v,
  ),

  XLOOKUP: (args, env) => {
    const look = arrOf(args[1]);
    const ret = arrOf(args[2]);
    const notFound = args[3];
    const mode = args[4] != null ? int(args[4], 'XLOOKUP match mode') : 0;
    const fromEnd = args[5] != null && int(args[5], 'XLOOKUP search mode') < 0;
    const list = look.data;
    const vertical = look.cols === 1;
    const v = args[0];
    const one = (x: Scalar): Value => {
      const i = matchIndex(x, list, mode, fromEnd);
      if (i < 0)
        return notFound != null && scalarOf(notFound) != null
          ? notFound
          : new XErr('#N/A', `"${text(x)}" was not found`);
      if (vertical) return ret.cols === 1 ? ret.at(i, 0) : pickRows(ret, [i]);
      return ret.rows === 1 ? ret.at(0, i) : new Arr(ret.rows, 1, columnOf(ret, i));
    };
    if (v instanceof Arr) return lift([v], ([x]) => scalarOf(one(x)), env);
    return one(scalarOf(v));
  },
  VLOOKUP: (args, env) => {
    const table = arrOf(args[1]);
    const col = int(args[2], 'VLOOKUP column') - 1;
    const approx = args[3] == null ? true : bool(scalarOf(args[3])) === true;
    if (col < 0 || col >= table.cols) return new XErr('#REF!', 'that column is outside the table');
    const first = columnOf(table, 0);
    return lift(
      [args[0]],
      ([x]) => {
        const i = matchIndex(
          x,
          first,
          approx ? -1 : typeof x === 'string' && /[*?]/.test(x) ? 2 : 0,
        );
        return i < 0 ? new XErr('#N/A', `"${text(x)}" was not found`) : table.at(i, col);
      },
      env,
    );
  },
  HLOOKUP: (args, env) => {
    const table = arrOf(args[1]);
    const row = int(args[2], 'HLOOKUP row') - 1;
    const approx = args[3] == null ? true : bool(scalarOf(args[3])) === true;
    if (row < 0 || row >= table.rows) return new XErr('#REF!');
    const first = rowOf(table, 0);
    return lift(
      [args[0]],
      ([x]) => {
        const i = matchIndex(x, first, approx ? -1 : 0);
        return i < 0 ? new XErr('#N/A', `"${text(x)}" was not found`) : table.at(row, i);
      },
      env,
    );
  },
  MATCH: (args, env) => {
    const list = arrOf(args[1]).data;
    const type = args[2] == null ? 1 : int(args[2], 'MATCH type');
    return lift(
      [args[0]],
      ([x]) => {
        const i = matchIndex(
          x,
          list,
          type === 0 ? (typeof x === 'string' && /[*?]/.test(x) ? 2 : 0) : type === 1 ? -1 : 1,
        );
        return i < 0 ? new XErr('#N/A', `"${text(x)}" was not found`) : i + 1;
      },
      env,
    );
  },
  XMATCH: (args, env) => {
    const list = arrOf(args[1]).data;
    const mode = args[2] == null ? 0 : int(args[2], 'XMATCH mode');
    return lift(
      [args[0]],
      ([x]) => {
        const i = matchIndex(x, list, mode);
        return i < 0 ? new XErr('#N/A') : i + 1;
      },
      env,
    );
  },
  INDEX: (args) => {
    const a = arrOf(args[0]);
    let r = args[1] == null ? 0 : int(args[1], 'INDEX row');
    let c = args[2] == null ? 0 : int(args[2], 'INDEX column');
    if (a.rows === 1 && args[2] == null) [r, c] = [1, r];
    if (r === 0 && c > 0) return new Arr(a.rows, 1, columnOf(a, c - 1));
    if (c === 0 && r > 0) return a.cols === 1 ? a.at(r - 1, 0) : pickRows(a, [r - 1]);
    if (r < 1 || c < 1 || r > a.rows || c > a.cols) return new XErr('#REF!', 'outside the range');
    return a.at(r - 1, c - 1);
  },
  CHOOSE: (args) => {
    const i = int(args[0], 'CHOOSE index');
    return i >= 1 && i < args.length ? args[i] : new XErr('#VALUE!');
  },

  FILTER: (args) => {
    const a = arrOf(args[0]);
    const inc = arrOf(args[1]);
    const idx: number[] = [];
    if (inc.data.length === a.rows)
      for (let r = 0; r < a.rows; r++) {
        if (bool(inc.data[r]) === true) idx.push(r);
      }
    else if (inc.rows === 1 && inc.cols === a.cols) {
      const cols: number[] = [];
      for (let c = 0; c < a.cols; c++) if (bool(inc.data[c]) === true) cols.push(c);
      return chooseCols(a, cols);
    } else return new XErr('#VALUE!', 'FILTER needs one TRUE/FALSE per row');
    if (!idx.length) return args[2] !== undefined ? args[2] : new XErr('#CALC!', 'no rows match');
    return pickRows(a, idx);
  },
  SORT: (args) => {
    const a = arrOf(args[0]);
    const by = args[1] == null ? 1 : int(args[1], 'SORT column');
    const desc = args[2] != null && int(args[2], 'SORT order') < 0;
    if (by < 1 || by > a.cols) return new XErr('#VALUE!', 'SORT column is outside the array');
    return sortRows(a, [{ col: columnOf(a, by - 1), desc }]);
  },
  SORTBY: (args) => {
    const a = arrOf(args[0]);
    const keys: { col: Scalar[]; desc: boolean }[] = [];
    for (let i = 1; i < args.length; i += 2) {
      const k = arrOf(args[i]);
      if (k.data.length !== a.rows) return new XErr('#VALUE!', 'SORTBY needs one key per row');
      keys.push({ col: k.data, desc: args[i + 1] != null && int(args[i + 1], 'SORTBY order') < 0 });
    }
    return sortRows(a, keys);
  },
  UNIQUE: (args) => {
    const a = arrOf(args[0]);
    const seen = new Map<string, number>();
    const idx: number[] = [];
    for (let r = 0; r < a.rows; r++) {
      const row = rowOf(a, r);
      if (row.every((v) => v == null)) continue;
      const k = keyOf(row);
      if (!seen.has(k)) {
        seen.set(k, r);
        idx.push(r);
      }
    }
    return pickRows(a, idx);
  },
  TAKE: (args) => {
    const a = arrOf(args[0]);
    const n = int(args[1], 'TAKE rows');
    const idx = Array.from({ length: a.rows }, (_, i) => i);
    const kept = n >= 0 ? idx.slice(0, n) : idx.slice(n);
    let out = pickRows(a, kept);
    if (args[2] != null) {
      const c = int(args[2], 'TAKE columns');
      const cols = Array.from({ length: a.cols }, (_, i) => i);
      out = chooseCols(out, c >= 0 ? cols.slice(0, c) : cols.slice(c));
    }
    return out;
  },
  DROP: (args) => {
    const a = arrOf(args[0]);
    const n = int(args[1], 'DROP rows');
    const idx = Array.from({ length: a.rows }, (_, i) => i);
    return pickRows(a, n >= 0 ? idx.slice(n) : idx.slice(0, n));
  },
  CHOOSECOLS: (args) => {
    const a = arrOf(args[0]);
    return chooseCols(
      a,
      args.slice(1).map((v) => {
        const c = int(v, 'CHOOSECOLS column');
        return c < 0 ? a.cols + c : c - 1;
      }),
    );
  },
  CHOOSEROWS: (args) => {
    const a = arrOf(args[0]);
    return pickRows(
      a,
      args
        .slice(1)
        .map((v) => {
          const r = int(v, 'CHOOSEROWS row');
          return r < 0 ? a.rows + r : r - 1;
        })
        .filter((r) => r >= 0 && r < a.rows),
    );
  },
  HSTACK: (args) => {
    const arrs = args.map(arrOf);
    const rows = Math.max(...arrs.map((a) => a.rows));
    const cols = arrs.reduce((n, a) => n + a.cols, 0);
    const data: Scalar[] = [];
    for (let r = 0; r < rows; r++)
      for (const a of arrs)
        for (let c = 0; c < a.cols; c++) data.push(r < a.rows ? a.at(r, c) : new XErr('#N/A'));
    const headers = arrs.every((a) => a.headers) ? arrs.flatMap((a) => a.headers!) : undefined;
    return new Arr(rows, cols, data, headers);
  },
  VSTACK: (args) => {
    const arrs = args.map(arrOf);
    const cols = Math.max(...arrs.map((a) => a.cols));
    const data: Scalar[] = [];
    let rows = 0;
    for (const a of arrs)
      for (let r = 0; r < a.rows; r++, rows++)
        for (let c = 0; c < cols; c++) data.push(c < a.cols ? a.at(r, c) : new XErr('#N/A'));
    return new Arr(rows, cols, data);
  },
  TRANSPOSE: (args) => {
    const a = arrOf(args[0]);
    const data: Scalar[] = [];
    for (let c = 0; c < a.cols; c++) for (let r = 0; r < a.rows; r++) data.push(a.at(r, c));
    return new Arr(a.cols, a.rows, data);
  },
  TOCOL: (args) => {
    const a = arrOf(args[0]);
    const data = a.data.filter((v) => v != null);
    return new Arr(data.length, 1, data);
  },
  ROWS: (args) => arrOf(args[0]).rows,
  COLUMNS: (args) => arrOf(args[0]).cols,
  SEQUENCE: (args) => {
    const rows = int(args[0], 'SEQUENCE rows');
    const cols = args[1] == null ? 1 : int(args[1], 'SEQUENCE columns');
    const start = args[2] == null ? 1 : Number(num(s0(args, 2)));
    const stepBy = args[3] == null ? 1 : Number(num(s0(args, 3)));
    if (rows < 1 || cols < 1 || rows * cols > 100_000)
      return new XErr('#VALUE!', 'SEQUENCE size must be 1 to 100,000');
    return new Arr(
      rows,
      cols,
      Array.from({ length: rows * cols }, (_, i) =>
        roundTo(start + i * stepBy, Math.max(decimals(start), decimals(stepBy))),
      ),
    );
  },

  GROUPBY: (args, env) => {
    const keys = arrOf(args[0]);
    const vals = arrOf(args[1]);
    const f = args[2];
    if (keys.rows !== vals.rows) return new XErr('#VALUE!', 'GROUPBY needs one key per value row');
    const groups = new Map<string, { key: Scalar[]; rows: number[] }>();
    for (let r = 0; r < keys.rows; r++) {
      const key = rowOf(keys, r);
      if (key.every((v) => v == null || v === '')) continue;
      const k = keyOf(key);
      const g = groups.get(k) ?? { key, rows: [] };
      g.rows.push(r);
      groups.set(k, g);
    }
    step(env, keys.rows);
    const list = [...groups.values()].sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) {
        const c = cmp(a.key[i], b.key[i]);
        if (c) return c;
      }
      return 0;
    });
    const total = fnName(f) === 'PERCENTOF' ? exactSumOf(vals) : 0;
    const data: Scalar[] = [];
    for (const g of list) {
      data.push(...g.key);
      for (let c = 0; c < vals.cols; c++) {
        const sub = new Arr(
          g.rows.length,
          1,
          g.rows.map((r) => vals.at(r, c)),
        );
        data.push(
          fnName(f) === 'PERCENTOF'
            ? total
              ? exactSumOf(sub) / total
              : new XErr('#DIV/0!')
            : aggregateWith(f, sub, env),
        );
      }
    }
    const headers = [
      ...(keys.headers ?? Array.from({ length: keys.cols }, () => '')),
      ...(vals.headers ?? Array.from({ length: vals.cols }, () => '')).map(
        (h) => `${fnName(f)}${h ? ` of ${h}` : ''}`,
      ),
    ];
    return new Arr(list.length, keys.cols + vals.cols, data, headers);
  },
  PIVOTBY: (args, env) => {
    const rk = arrOf(args[0]);
    const ck = arrOf(args[1]);
    const vals = arrOf(args[2]);
    const f = args[3];
    if (rk.rows !== vals.rows || ck.rows !== vals.rows)
      return new XErr('#VALUE!', 'PIVOTBY needs one key per value row');
    const rowKeys = new Map<string, Scalar>();
    const colKeys = new Map<string, Scalar>();
    const cells = new Map<string, number[]>();
    for (let r = 0; r < vals.rows; r++) {
      const a = rk.data[r];
      const b = ck.data[r];
      if (a == null || b == null) continue;
      const ka = keyOf([a]);
      const kb = keyOf([b]);
      rowKeys.set(ka, a);
      colKeys.set(kb, b);
      const k = `${ka}\u0002${kb}`;
      const list = cells.get(k) ?? [];
      list.push(r);
      cells.set(k, list);
    }
    step(env, vals.rows);
    const rs = [...rowKeys.entries()].sort((x, y) => cmp(x[1], y[1]));
    const cs = [...colKeys.entries()].sort((x, y) => cmp(x[1], y[1]));
    if (rs.length * cs.length > 100_000) return new XErr('#VALUE!', 'the pivot is too big');
    const data: Scalar[] = [];
    for (const [ka, a] of rs) {
      data.push(a);
      for (const [kb] of cs) {
        const list = cells.get(`${ka}\u0002${kb}`);
        data.push(
          list
            ? aggregateWith(
                f,
                new Arr(
                  list.length,
                  1,
                  list.map((r) => vals.at(r, 0)),
                ),
                env,
              )
            : null,
        );
      }
    }
    const headers = [rk.headers?.[0] ?? '', ...cs.map(([, b]) => text(b))];
    return new Arr(rs.length, cs.length + 1, data, headers);
  },
  PERCENTOF: (args) => {
    const all = exactSumOf(arrOf(args[1] ?? args[0]));
    return all ? exactSumOf(arrOf(args[0])) / all : new XErr('#DIV/0!');
  },
  MAP: (args, env) => {
    const f = args[args.length - 1];
    const arrs = args.slice(0, -1);
    return lift(arrs, (xs) => scalarOf(callFn(f, xs, env)), env);
  },
  REDUCE: (args, env) => {
    let acc: Value = args[0];
    for (const v of arrOf(args[1]).data) {
      step(env);
      acc = callFn(args[2], [acc, v], env);
    }
    return acc;
  },
  SCAN: (args, env) => {
    const a = arrOf(args[1]);
    let acc: Value = args[0];
    const out: Scalar[] = [];
    for (const v of a.data) {
      step(env);
      acc = callFn(args[2], [acc, v], env);
      out.push(scalarOf(acc));
    }
    return new Arr(a.rows, a.cols, out, undefined, a.rowNos);
  },
  BYROW: (args, env) => {
    const a = arrOf(args[0]);
    const out: Scalar[] = [];
    for (let r = 0; r < a.rows; r++)
      out.push(scalarOf(callFn(args[1], [new Arr(1, a.cols, rowOf(a, r))], env)));
    return new Arr(a.rows, 1, out, undefined, a.rowNos);
  },
  BYCOL: (args, env) => {
    const a = arrOf(args[0]);
    const out: Scalar[] = [];
    for (let c = 0; c < a.cols; c++)
      out.push(scalarOf(callFn(args[1], [new Arr(a.rows, 1, columnOf(a, c))], env)));
    return new Arr(1, a.cols, out, a.headers);
  },
};

// Older and other names for the same functions.
const ALIASES: Record<string, string> = {
  STDEV: 'STDEV.S',
  STDEVP: 'STDEV.P',
  VAR: 'VAR.S',
  VARP: 'VAR.P',
  MODE: 'MODE.SNGL',
  RANK: 'RANK.EQ',
  PERCENTILE: 'PERCENTILE.INC',
  CONCATENATE: 'CONCAT',
  'CEILING.MATH': 'CEILING',
  'FLOOR.MATH': 'FLOOR',
};
for (const [a, b] of Object.entries(ALIASES)) FUNCS[a] = FUNCS[b];

function exactSumOf(a: Arr): number {
  const xs = numbers([a]);
  return isErr(xs) ? NaN : exactSum(xs);
}

function chooseCols(a: Arr, cols: number[]): Arr {
  const ok = cols.filter((c) => c >= 0 && c < a.cols);
  const data: Scalar[] = [];
  for (let r = 0; r < a.rows; r++) for (const c of ok) data.push(a.at(r, c));
  return new Arr(
    a.rows,
    ok.length,
    data,
    a.headers ? ok.map((c) => a.headers![c]) : undefined,
    a.rowNos,
  );
}

function withDate(v: Scalar, f: (serial: number) => Scalar): Scalar {
  const n = dateArg(v);
  return isErr(n) ? n : v == null ? new XErr('#VALUE!', 'the date is empty') : f(n);
}

function isoWeek(serial: number): number {
  const d = new Date(msFromSerial(Math.floor(serial)));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(
      (d.getTime() - firstThursday.getTime()) / 604_800_000 -
        (((firstThursday.getUTCDay() + 6) % 7) - 3) / 7,
    )
  );
}

function pickNums(a: Arr, m: (i: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.data.length; i++) {
    if (!m(i)) continue;
    const v = a.data[i];
    if (typeof v === 'number') out.push(v);
    else if (v instanceof XDate) out.push(v.serial);
  }
  return out;
}

const sumWhere = (a: Arr, m: (i: number) => boolean) => exactSum(pickNums(a, m));
const avgWhere = (a: Arr, m: (i: number) => boolean) => {
  const xs = pickNums(a, m);
  return xs.length ? mean(xs) : new XErr('#DIV/0!', 'no rows match');
};
function countWhere(n: number, m: (i: number) => boolean): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (m(i)) k++;
  return k;
}

/** Functions whose arguments are worked out only when needed (IF's other branch, LET, LAMBDA). */
const LAZY: Record<string, (args: Node[], env: Env) => Value> = {
  IF: (args, env) => {
    if (args.length < 2 || args.length > 3) throw new FormulaError('IF takes 2 or 3 arguments');
    const c = evaluate(args[0], env);
    if (!(c instanceof Arr)) {
      const b = bool(scalarOf(c));
      if (isErr(b)) return b;
      return b ? evaluate(args[1], env) : args[2] ? evaluate(args[2], env) : false;
    }
    const yes = evaluate(args[1], env);
    const no = args[2] ? evaluate(args[2], env) : false;
    return lift(
      [c, yes, no],
      ([x, y, n]) => {
        const b = bool(x);
        return isErr(b) ? b : b ? y : n;
      },
      env,
    );
  },
  IFS: (args, env) => {
    if (args.length % 2) throw new FormulaError('IFS takes pairs of test, value');
    const vals = args.map((a) => evaluate(a, env));
    return lift(
      vals,
      (xs) => {
        for (let i = 0; i < xs.length; i += 2) {
          const b = bool(xs[i]);
          if (isErr(b)) return b;
          if (b) return xs[i + 1];
        }
        return new XErr('#N/A', 'no test was TRUE');
      },
      env,
    );
  },
  SWITCH: (args, env) => {
    const vals = args.map((a) => evaluate(a, env));
    return lift(
      vals,
      (xs) => {
        const [v, ...rest] = xs;
        for (let i = 0; i + 1 < rest.length; i += 2) if (cmp(v, rest[i]) === 0) return rest[i + 1];
        return rest.length % 2 ? rest[rest.length - 1] : new XErr('#N/A');
      },
      env,
    );
  },
  IFERROR: (args, env) => {
    let v: Value;
    try {
      v = evaluate(args[0], env);
    } catch (e) {
      if (!(e instanceof FormulaError) || /too long|too deep|too big/.test(e.message)) throw e;
      return evaluate(args[1], env);
    }
    const alt = evaluate(args[1], env);
    return lift([v, alt], ([x, y]) => (isErr(x) ? y : x), env);
  },
  IFNA: (args, env) => {
    const v = evaluate(args[0], env);
    const alt = evaluate(args[1], env);
    return lift([v, alt], ([x, y]) => (isErr(x) && x.code === '#N/A' ? y : x), env);
  },
  LET: (args, env) => {
    if (args.length < 3 || args.length % 2 === 0)
      throw new FormulaError('LET takes name, value pairs and then the result');
    const saved = new Map(env.vars);
    try {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const n = args[i];
        if (n.k !== 'name') throw new FormulaError('LET names must be plain words');
        env.vars.set(n.name.toUpperCase(), evaluate(args[i + 1], env));
      }
      return evaluate(args[args.length - 1], env);
    } finally {
      env.vars = saved;
    }
  },
  LAMBDA: (args, env) => {
    const params = args.slice(0, -1).map((p) => {
      if (p.k !== 'name') throw new FormulaError('LAMBDA parameters must be plain words');
      return p.name.toUpperCase();
    });
    const body = args[args.length - 1];
    const closure = new Map(env.vars);
    return new Fn('LAMBDA', (vals) => {
      const saved = env.vars;
      env.vars = new Map(closure);
      params.forEach((p, i) => env.vars.set(p, vals[i] ?? null));
      try {
        return evaluate(body, env);
      } finally {
        env.vars = saved;
      }
    });
  },
};

/** Every function name the formulas know (for the model's tool description and tests). */
export const FUNCTION_NAMES = [...Object.keys(FUNCS), ...Object.keys(LAZY)].sort();

export type FormulaResult = { value: Value; formula: string };

/** Works out [formula] on [ctx]'s sheets. Throws FormulaError with a plain reason. */
export function runFormula(formula: string, ctx: FormulaContext): Value {
  return evaluateTree(
    parseFormula(
      formula,
      ctx.sheets.map((x) => x.name),
    ),
    ctx,
  );
}

function evaluateTree(tree: Node, ctx: FormulaContext): Value {
  const env: Env = {
    ctx,
    tables: new Map(),
    vars: new Map(),
    steps: 0,
    depth: 0,
    t0: Date.now(),
    checked: 0,
  };
  const v = evaluate(tree, env);
  if (v instanceof Fn) throw new FormulaError('the formula gives a function, not a value');
  return v;
}

// --- Showing a result ---

const cellText = (v: Scalar) => (isErr(v) ? `${v.code}${v.why ? ` (${v.why})` : ''}` : text(v));

/** A result in plain lines: one value, or a small table (rows cut at [maxRows]). */
export function resultText(v: Value, maxRows = 30): string {
  if (!(v instanceof Arr)) return cellText(scalarOf(v));
  if (v.rows === 1 && v.cols === 1) return cellText(v.at(0, 0));
  if (!v.rows || !v.cols) return '(nothing)';
  const lines: string[] = [];
  const shown = Math.min(v.rows, maxRows);
  const row = (r: number) => rowOf(v, r).map(cellText);
  if (v.cols === 1) {
    for (let r = 0; r < shown; r++)
      lines.push(`${v.rowNos ? `Row ${v.rowNos[r]}: ` : '- '}${cellText(v.at(r, 0))}`);
  } else if (v.cols === 2 && !v.rowNos) {
    for (let r = 0; r < shown; r++) {
      const [k, x] = row(r);
      lines.push(`${k}: ${x}`);
    }
  } else {
    if (v.headers?.some(Boolean)) lines.push(v.headers.join(' | '));
    for (let r = 0; r < shown; r++)
      lines.push(`${v.rowNos ? `Row ${v.rowNos[r]}: ` : ''}${row(r).join(' | ')}`);
  }
  if (v.rows > shown) lines.push(`…and ${v.rows - shown} more (${v.rows} in all).`);
  const head =
    v.cols === 2 && !v.rowNos && v.headers?.some(Boolean) ? `${v.headers.join(' → ')}\n` : '';
  return head + lines.join('\n');
}

/** The error in a result, if all of it is one error (for a retry with the reason). */
export function resultError(v: Value): string | null {
  const s = v instanceof Arr ? (v.rows * v.cols === 1 ? v.at(0, 0) : null) : (v as Scalar);
  if (!isErr(s)) return null;
  return `${s.code}${s.why ? `: ${s.why}` : ''}`;
}

/** A single cell with no $ before its row (B2, $B2): it moves with the row when filled down. */
function hasMovingCell(n: Node): boolean {
  switch (n.k) {
    case 'cell':
      return !n.rowFixed;
    case 'call':
      return n.args.some(hasMovingCell);
    case 'un':
      return hasMovingCell(n.a);
    case 'bin':
      return hasMovingCell(n.a) || hasMovingCell(n.b);
    case 'array':
      return n.rows.some((r) => r.some(hasMovingCell));
    default:
      return false;
  }
}

/**
 * [n] for the row [d] below: single cells move, ranges stay (they are totals and lookups, like
 * SUM(B2:B5), which a model rarely writes with $).
 */
function fillDown(n: Node, d: number): Node {
  switch (n.k) {
    case 'cell':
      return n.rowFixed ? n : { ...n, row: n.row + d };
    case 'call':
      return { ...n, args: n.args.map((a) => fillDown(a, d)) };
    case 'un':
      return { ...n, a: fillDown(n.a, d) };
    case 'bin':
      return { ...n, a: fillDown(n.a, d), b: fillDown(n.b, d) };
    case 'array':
      return { ...n, rows: n.rows.map((r) => r.map((x) => fillDown(x, d))) };
    default:
      return n;
  }
}

/**
 * The sheet with a new column [name] holding the formula's result: one value per data row (or
 * the same value in every row). Throws FormulaError when the result doesn't fit.
 */
export function addColumn(
  ctx: FormulaContext,
  name: string,
  formula: string,
): { sheet: Sheet; col: number; values: Scalar[] } {
  const tree = parseFormula(
    formula,
    ctx.sheets.map((x) => x.name),
  );
  const v = evaluateTree(tree, ctx);
  const sheet = ctx.sheets[ctx.sheet];
  const t = tableOf(sheet);
  const n = sheet.rows.length - t.first;
  let values: Scalar[];
  const one = !(v instanceof Arr) || (v.rows === 1 && v.cols === 1);
  if (one && hasMovingCell(tree)) {
    // "=B2*0.2" is written for the first row and filled down, as in a spreadsheet: it gave the
    // first row's VAT in every row (phone check, 28 Nov).
    values = Array.from({ length: n }, (_, i) => {
      const r = i ? evaluateTree(fillDown(tree, i), ctx) : v;
      return r instanceof Arr ? r.at(0, 0) : (r as Scalar);
    });
  } else if (v instanceof Arr) {
    if (v.cols !== 1 || (v.rows !== n && v.rows !== 1))
      throw new FormulaError(
        `a new column needs one value per row (${n} rows), and this gives ${v.rows} × ${v.cols}`,
      );
    values = v.rows === 1 ? Array.from({ length: n }, () => v.at(0, 0)) : v.data.slice();
  } else values = Array.from({ length: n }, () => v as Scalar);
  const col = t.width;
  const rows = sheet.rows.map((r) => r.slice());
  if (t.headerRow >= 0) {
    const h = rows[t.headerRow];
    while (h.length < col) h.push(null);
    h[col] = name;
  }
  for (let i = 0; i < n; i++) {
    const r = rows[t.first + i];
    while (r.length < col) r.push(null);
    r[col] = values[i];
  }
  return { sheet: { ...sheet, rows }, col, values };
}

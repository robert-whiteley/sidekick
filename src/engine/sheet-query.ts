/**
 * Questions about an attached spreadsheet: the model writes one Excel formula (the query_sheet
 * tool, tools-logic.ts), code works it out exactly (src/files/formula.ts) and the answer shows
 * the formula used (a question in parts may get several, separated by ";": each is shown with
 * its result). A formula that can't be read or worked out is asked for once more with the
 * reason. "Add a column" returns the changed sheet, which can be saved as CSV. The model call is
 * passed in, so this is tested without one (__tests__/sheet-query-test.ts).
 */
import {
  addColumn,
  findColumn,
  FormulaError,
  type FormulaContext,
  resultError,
  resultText,
  runFormula,
  splitFormulas,
  splitTop,
} from '@/files/formula';
import {
  columnValues,
  formatValue,
  onlyNumberColumn,
  type Sheet,
  sheetSummary,
  tableOf,
} from '@/files/sheet';
import {
  fillPrompt,
  parseFillReply,
  ROUTER_SYSTEM,
  SHEET_TOOL,
  type ToolSpec,
  validateCall,
} from './tools-logic';

type Ask = (prompt: string, system: string, maxTokens: number) => Promise<string>;

/** The sheet's description is cut here so the prompt fits the model's window with room left. */
const SUMMARY_CHARS = 3000;
/** A formula is short; the reply's tokens allow a long one. */
const FILL_TOKENS = 260;

export type SheetAnswer =
  /** Worked out: the answer text (result + formula), and the changed sheets after a new column. */
  | { kind: 'answer'; text: string; formula: string; sheets?: Sheet[] }
  /** The model said the tool doesn't fit (a question about the sheet's words): read it instead. */
  | { kind: 'read' }
  /** No formula worked, after one retry: the reason, for the reply. */
  | { kind: 'failed'; text: string; formula?: string };

/** The tool for this workbook: its sheets and columns in the description. */
export function sheetTool(sheets: Sheet[]): ToolSpec {
  let summary = sheetSummary(sheets);
  if (summary.length > SUMMARY_CHARS) summary = `${summary.slice(0, SUMMARY_CHARS)}…`;
  return { ...SHEET_TOOL, desc: `${SHEET_TOOL.desc}.\nThe spreadsheet:\n${summary}` };
}

const asFormula = (f: string) => (f.trim().startsWith('=') ? f.trim() : `=${f.trim()}`);

/** Conditional totals: one value each, for the rows matching their conditions. */
const CONDITIONAL = /^=?\s*(SUMIFS?|COUNTIFS?|AVERAGEIFS?|MAXIFS|MINIFS)\s*\(/i;

/** Whether [term] is one call whose bracket closes at its end. */
function oneCall(term: string): boolean {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < term.length; i++) {
    const c = term[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i === term.length - 1;
  }
  return false;
}

/**
 * The terms of [formula] when it adds up conditional totals (SUMIF(...)+SUMIF(...)), else null.
 * Asked for "a total per team", the model wrote one SUMIF per team added together, so the answer
 * was one grand total (cloud emulator; a description with a GROUPBY example didn't stop it on the
 * laptop). Each term is then shown with its own result, and the sum after them.
 */
export function conditionalTerms(formula: string): string[] | null {
  const terms = splitTop(formula, '+');
  return terms.length > 1 && terms.every((t) => CONDITIONAL.test(t) && oneCall(t)) ? terms : null;
}

/** Aggregate → [over all rows, with conditions]. */
const AGGREGATES: Record<string, [string, string]> = {
  sum: ['SUM', 'SUMIFS'],
  count: ['COUNTA', 'COUNTIFS'],
  average: ['AVERAGE', 'AVERAGEIFS'],
  max: ['MAX', 'MAXIFS'],
  min: ['MIN', 'MINIFS'],
};

const words = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;

/** What [question] asks of column [group]: a result for each of its values, for the values it names, or over all rows. */
export type GroupAsk = { each: true } | { values: string[] } | null;

/**
 * Reads [question] for column [group]: the values of it the question names ("team Red", "Red
 * and Blue"), else each value when it names the column ("each team", "per team"), else none
 * (over all rows). The model gave group_by for "the total cost" and "the most expensive item"
 * too (laptop, 28 Nov), so the question decides, not the reply.
 */
export function groupAsked(question: string, sheet: Sheet, group: string): GroupAsk {
  const t = tableOf(sheet);
  const c = findColumn(t, group.trim().replace(/^\[|\]$/g, ''));
  if (c < 0) return { each: true }; // an unknown column is refused, with its reason, when worked out
  const q = words(question);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const v of columnValues(t, c)) {
    const text = formatValue(v);
    const w = words(text);
    if (!w.trim() || seen.has(w)) continue;
    seen.add(w);
    if (q.includes(w)) values.push(text);
  }
  if (values.length) return { values };
  const header = words(t.headers[c] || group).trim();
  return header && (q.includes(` ${header} `) || q.includes(` ${header}s `))
    ? { each: true }
    : null;
}

/**
 * The formula for [aggregate] of column [of] by column [group], as [asked]: one result for each
 * value, largest first (smallest first for min) so "which team spent the most" is the top line;
 * one for each named value; or one over all rows. The model only names the columns and the
 * aggregate: it wrote per-group formulas wrongly (SUMIF+SUMIF+SUMIF, a grand total; GROUPBY with
 * COUNT inside; one team's average). [numbers] is the sheet's only column of numbers, meant
 * when "of" is left out ("how much did each team spend").
 */
export function groupedFormula(
  group: string,
  aggregate: string,
  of: string,
  asked: GroupAsk,
  numbers: string | null = null,
): string {
  const col = (c: string) => `[${c.trim().replace(/^\[|\]$/g, '')}]`;
  const name = aggregate.trim().toLowerCase();
  const over = of.trim() || (name === 'count' ? '' : (numbers ?? ''));
  const [all, ifs] = AGGREGATES[name] ?? AGGREGATES[over ? 'sum' : 'count'];
  if (!over && all !== 'COUNTA')
    throw new FormulaError(`say in "of" which column to ${name || 'sum'} for each ${group}`);
  const g = col(group);
  const values = over ? col(over) : g;
  if (asked && 'values' in asked) {
    const cond = (v: string) => `${g},"${v.replace(/"/g, '""')}"`;
    return asked.values
      .map((v) => (all === 'COUNTA' ? `=${ifs}(${cond(v)})` : `=${ifs}(${values},${cond(v)})`))
      .join('; ');
  }
  if (asked) return `=SORT(GROUPBY(${g},${values},${all}),2,${all === 'MIN' ? 1 : -1})`;
  return `=${all}(${values})`;
}

/** The answer text: what it is, the result, and the formula used. */
export function sheetAnswerText(result: string, formula: string, label?: string): string {
  const multi = result.includes('\n');
  const head = label ? (multi ? `${label}:\n` : `${label}: `) : '';
  return `${head}${result}\n\nFormula: ${asFormula(formula)}`;
}

/** Works out [question] on [sheets] (bare columns refer to [sheet]). */
export async function answerSheetQuestion(
  question: string,
  sheets: Sheet[],
  sheet: number,
  ask: Ask,
  now = new Date(),
): Promise<SheetAnswer> {
  const tool = sheetTool(sheets);
  const prompt = fillPrompt(question, now, tool);
  const ctx: FormulaContext = { sheets, sheet, now: now.getTime() };
  let p = prompt;
  let last: { formula?: string; error: string } = { error: '' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await ask(p, ROUTER_SYSTEM, FILL_TOKENS).catch(() => '');
    const call = parseFillReply(reply, tool.name);
    if (call?.tool === 'none') return attempt === 0 ? { kind: 'read' } : failed(last);
    const v = call ? validateCall(call, [tool]) : null;
    if (!v || !v.ok) {
      last = { error: v && !v.ok ? v.error : 'no formula in the reply' };
    } else {
      const label = typeof v.args.label === 'string' ? v.args.label : undefined;
      const column = typeof v.args.new_column === 'string' ? v.args.new_column : undefined;
      const group = typeof v.args.group_by === 'string' ? v.args.group_by.trim() : '';
      let formula = typeof v.args.formula === 'string' ? v.args.formula : '';
      try {
        if (group && !column) {
          const asked = groupAsked(question, sheets[sheet], group);
          // The model's formula is kept unless one result for each value is asked, or it gave none.
          if ((asked && 'each' in asked) || !formula.trim())
            formula = groupedFormula(
              group,
              String(v.args.aggregate ?? ''),
              String(v.args.of ?? ''),
              asked,
              onlyNumberColumn(sheets[sheet]),
            );
        }
        if (!formula.trim()) throw new FormulaError('formula missing');
        if (column) {
          const r = addColumn(ctx, column, formula);
          const changed = sheets.map((s, i) => (i === sheet ? r.sheet : s));
          const shown = r.values.slice(0, 5).map(formatValue).join(', ');
          const more = r.values.length > 5 ? ', …' : '';
          const text = sheetAnswerText(
            `Added the column "${column}" (${r.values.length} rows: ${shown}${more}). Save the sheet to keep it.`,
            formula,
          );
          return { kind: 'answer', text, formula: asFormula(formula), sheets: changed };
        }
        const split = splitFormulas(formula);
        const terms = split.length === 1 ? conditionalTerms(formula) : null;
        const parts = terms ?? split;
        if (parts.length > 1) {
          // Several formulas for a question in parts: each result with its own formula.
          const values = parts.map((f) => runFormula(f, ctx));
          const bad = values.findIndex((v) => resultError(v));
          if (bad >= 0)
            last = { formula, error: `${asFormula(parts[bad])} gives ${resultError(values[bad])}` };
          else {
            const lines = values.map((v, i) => `${resultText(v)} (${asFormula(parts[i])})`);
            if (terms) lines.push(`Together: ${resultText(runFormula(formula, ctx))}`);
            return {
              kind: 'answer',
              text: `${label ? `${label}:\n` : ''}${lines.join('\n')}`,
              formula: parts.map(asFormula).join('; '),
            };
          }
        } else {
          const value = runFormula(formula, ctx);
          const err = resultError(value);
          if (err) last = { formula, error: `the formula gives ${err}` };
          else
            return {
              kind: 'answer',
              text: sheetAnswerText(resultText(value), formula, label),
              formula: asFormula(formula),
            };
        }
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
        last = { formula, error: e.message };
      }
    }
    p = `${prompt}\nYour reply ${reply.trim().slice(0, 300)} didn't work: ${last.error}. Reply again with a corrected formula.`;
  }
  return failed(last);
}

function failed(last: { formula?: string; error: string }): SheetAnswer {
  const text = last.formula
    ? `I couldn't work that out from the sheet: ${last.error}.\n\nFormula tried: ${asFormula(last.formula)}`
    : "I couldn't work that out from the sheet. Try asking with the column names.";
  return { kind: 'failed', text, formula: last.formula };
}

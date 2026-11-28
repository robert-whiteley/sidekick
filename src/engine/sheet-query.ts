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
  FormulaError,
  type FormulaContext,
  resultError,
  resultText,
  runFormula,
  splitFormulas,
} from '@/files/formula';
import { formatValue, type Sheet, sheetSummary } from '@/files/sheet';
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
      const formula = String(v.args.formula);
      const label = typeof v.args.label === 'string' ? v.args.label : undefined;
      const column = typeof v.args.new_column === 'string' ? v.args.new_column : undefined;
      try {
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
        const parts = splitFormulas(formula);
        if (parts.length > 1) {
          // Several formulas for a question in parts: each result with its own formula.
          const values = parts.map((f) => runFormula(f, ctx));
          const bad = values.findIndex((v) => resultError(v));
          if (bad >= 0)
            last = { formula, error: `${asFormula(parts[bad])} gives ${resultError(values[bad])}` };
          else {
            const lines = values.map((v, i) => `${resultText(v)} (${asFormula(parts[i])})`);
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

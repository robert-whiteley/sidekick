/**
 * Questions about an attached spreadsheet (src/engine/sheet-query.ts): the model's formula is
 * worked out in code, a broken one is asked for again with the reason, and a new column comes
 * back as a changed sheet. The model is a stub here.
 */
import { answerSheetQuestion, sheetTool } from '@/engine/sheet-query';
import { csvSheet, toCsv } from '@/files/sheet';

const sheets = [
  csvSheet(
    'Date,Customer,Amount\n2026-03-02,Ann,10.10\n2026-03-15,Bob,20.20\n2026-04-01,Ann,5',
    'Sales',
    false,
  ),
];

function stub(...replies: string[]) {
  const prompts: string[] = [];
  const ask = async (p: string) => {
    prompts.push(p);
    return replies.shift() ?? '';
  };
  return { ask, prompts };
}

test('the tool shows the sheet and its columns', () => {
  const t = sheetTool(sheets);
  expect(t.name).toBe('query_sheet');
  expect(t.desc).toContain('Sheet "Sales"');
  expect(t.desc).toContain('Amount');
});

test('a formula is worked out and shown with the answer', async () => {
  const { ask } = stub('{"formula": "SUMIFS([Amount],[Customer],\\"Ann\\")", "label": "Ann paid"}');
  const r = await answerSheetQuestion('How much did Ann pay?', sheets, 0, ask);
  expect(r).toEqual({
    kind: 'answer',
    text: 'Ann paid: 15.1\n\nFormula: =SUMIFS([Amount],[Customer],"Ann")',
    formula: '=SUMIFS([Amount],[Customer],"Ann")',
  });
});

test('a broken formula is asked for once more, with the reason', async () => {
  const { ask, prompts } = stub('{"formula": "SUM([Total])"}', '{"formula": "SUM([Amount])"}');
  const r = await answerSheetQuestion('What is the total?', sheets, 0, ask);
  expect(r.kind).toBe('answer');
  if (r.kind === 'answer') expect(r.text).toMatch(/^35\.3\n/);
  expect(prompts[1]).toContain('there is no column [Total]');
});

test('two failures: the reason and the formula tried', async () => {
  const { ask } = stub('{"formula": "SUM([Amount]"}', '{"formula": "1/0"}');
  const r = await answerSheetQuestion('Total?', sheets, 0, ask);
  expect(r.kind).toBe('failed');
  if (r.kind === 'failed') expect(r.text).toContain('Formula tried: =1/0');
});

test('not a calculation: read the sheet instead', async () => {
  const { ask } = stub('{"none": true}');
  expect(await answerSheetQuestion('What is this sheet about?', sheets, 0, ask)).toEqual({
    kind: 'read',
  });
});

test('a new column comes back as a changed sheet that saves as CSV', async () => {
  const { ask } = stub('{"formula": "[Amount]*1.2", "new_column": "With VAT"}');
  const r = await answerSheetQuestion('Add a column with VAT at 20%', sheets, 0, ask);
  expect(r.kind).toBe('answer');
  if (r.kind !== 'answer' || !r.sheets) throw new Error('no sheet');
  expect(r.text).toContain('Added the column "With VAT" (3 rows: 12.12, 24.24, 6');
  expect(toCsv(r.sheets[0]).split(/\r?\n/)[1]).toBe('2026-03-02,Ann,10.1,12.12');
  expect(sheets[0].rows[0]).toHaveLength(3);
});

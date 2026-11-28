/**
 * Questions about an attached spreadsheet (src/engine/sheet-query.ts): the model's formula is
 * worked out in code, a broken one is asked for again with the reason, and a new column comes
 * back as a changed sheet. The model is a stub here.
 */
import {
  answerSheetQuestion,
  conditionalTerms,
  groupAsked,
  groupedFormula,
  sheetTool,
} from '@/engine/sheet-query';
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

test('a question in parts: each formula worked out and shown with its result', async () => {
  // The model wrote "=SUM(C:C) ; SUMIF(…) ; …" for "the total, and per customer" (28 Nov).
  const { ask } = stub(
    '{"formula": "=SUM(C:C) ; SUMIF(B:B, \\"Ann\\", C:C) ; SUMIF(B:B, \\"Bob\\", C:C)"}',
  );
  const r = await answerSheetQuestion('The total, and for each customer?', sheets, 0, ask);
  expect(r).toEqual({
    kind: 'answer',
    text: '35.3 (=SUM(C:C))\n15.1 (=SUMIF(B:B, "Ann", C:C))\n20.2 (=SUMIF(B:B, "Bob", C:C))',
    formula: '=SUM(C:C); =SUMIF(B:B, "Ann", C:C); =SUMIF(B:B, "Bob", C:C)',
  });
});

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

// "A total per team" got one grand total: the model added one SUMIF per team (cloud emulator).
test('conditional totals added together: each shown with its result, then the sum', async () => {
  const { ask } = stub(
    '{"formula": "=SUMIF(B:B, \\"Ann\\", C:C) + SUMIF(B:B, \\"Bob\\", C:C)", "label": "Totals"}',
  );
  const r = await answerSheetQuestion('A total for each customer', sheets, 0, ask);
  expect(r).toEqual({
    kind: 'answer',
    text: 'Totals:\n15.1 (=SUMIF(B:B, "Ann", C:C))\n20.2 (=SUMIF(B:B, "Bob", C:C))\nTogether: 35.3',
    formula: '=SUMIF(B:B, "Ann", C:C); =SUMIF(B:B, "Bob", C:C)',
  });
});

test('only a plain sum of conditional totals is split', () => {
  expect(conditionalTerms('=SUMIFS(C:C,A:A,"Red")+COUNTIF(A:A,"Blue")')).toEqual([
    '=SUMIFS(C:C,A:A,"Red")',
    'COUNTIF(A:A,"Blue")',
  ]);
  expect(conditionalTerms('=SUMIF(A:A,"Red",C:C)')).toBeNull();
  expect(conditionalTerms('=SUMIF(A:A,"Red",C:C)*2+SUMIF(A:A,"Blue",C:C)')).toBeNull();
  expect(conditionalTerms('=SUMIF(A:A,"Red",C:C)-SUMIF(A:A,"Blue",C:C)')).toBeNull();
  expect(conditionalTerms('=SUM(C:C)+SUMIF(A:A,"Blue",C:C)')).toBeNull();
  expect(conditionalTerms('=SUMIF(A:A,"a+b",C:C)')).toBeNull();
});

test('text in single quotes is read as text, not a sheet name', async () => {
  const { ask } = stub('{"formula": "=SUMIFS(C:C, B:B, \'Ann\')"}');
  const r = await answerSheetQuestion('How much did Ann spend?', sheets, 0, ask);
  expect(r).toMatchObject({ kind: 'answer', formula: "=SUMIFS(C:C, B:B, 'Ann')" });
  expect(r.kind === 'answer' && r.text).toMatch(/^15\.1\n/);
});

// One result per group is worked out in code from the columns and the aggregate the model names:
// it wrote SUMIF+SUMIF+SUMIF (a grand total), GROUPBY with COUNT inside, or one group's average.
const teams = [
  csvSheet(
    'Team,Item,Cost\nRed,Paint,12.40\nBlue,Brushes,8.75\nRed,Rollers,15.10\nGreen,Tape,3.99\nBlue,Paint,24.60',
    'Costs',
    false,
  ),
];

test('a result for each group: from group_by, aggregate and of, largest first', async () => {
  const { ask } = stub('{"group_by": "Team", "aggregate": "sum", "of": "Cost"}');
  const r = await answerSheetQuestion('Which team spent the most?', teams, 0, ask);
  expect(r).toMatchObject({ kind: 'answer', formula: '=SORT(GROUPBY([Team],[Cost],SUM),2,-1)' });
  expect(r.kind === 'answer' && r.text).toMatch(/Blue: 33\.35\nRed: 27\.5\nGreen: 3\.99/);
});

test('the column to add up defaults to the only one of numbers; count needs none', () => {
  const each = { each: true } as const;
  expect(groupedFormula('Team', 'sum', '', each, 'Cost')).toBe(
    '=SORT(GROUPBY([Team],[Cost],SUM),2,-1)',
  );
  expect(groupedFormula('Team', 'count', '', each, 'Cost')).toBe(
    '=SORT(GROUPBY([Team],[Team],COUNTA),2,-1)',
  );
  expect(groupedFormula('Team', 'min', 'Cost', each)).toBe('=SORT(GROUPBY([Team],[Cost],MIN),2,1)');
  expect(() => groupedFormula('Team', 'average', '', each, null)).toThrow(/say in "of"/);
});

test('the question decides: each group, the groups it names, or all rows', () => {
  const sheet = teams[0];
  expect(groupAsked('What is the total cost per team?', sheet, 'Team')).toEqual({ each: true });
  expect(groupAsked('Count the items for each team', sheet, 'Team')).toEqual({ each: true });
  expect(groupAsked('How much did team Red spend?', sheet, 'Team')).toEqual({ values: ['Red'] });
  expect(groupAsked('The total for Red and for Blue?', sheet, 'Team')).toEqual({
    values: ['Red', 'Blue'],
  });
  expect(groupAsked('What is the total cost?', sheet, 'Team')).toBeNull();
  expect(groupedFormula('Team', 'sum', 'Cost', { values: ['Red', 'Blue'] })).toBe(
    '=SUMIFS([Cost],[Team],"Red"); =SUMIFS([Cost],[Team],"Blue")',
  );
  expect(groupedFormula('Team', 'count', '', { values: ['Red'] })).toBe('=COUNTIFS([Team],"Red")');
  expect(groupedFormula('Team', 'max', 'Cost', null)).toBe('=MAX([Cost])');
});

test('group_by on a question about all rows: the total, not one per group', async () => {
  const { ask } = stub('{"group_by": "Team", "aggregate": "sum", "of": "Cost"}');
  const r = await answerSheetQuestion('What is the total cost?', teams, 0, ask);
  expect(r).toMatchObject({ kind: 'answer', formula: '=SUM([Cost])' });
  expect(r.kind === 'answer' && r.text).toMatch(/^64\.84\n/);
});

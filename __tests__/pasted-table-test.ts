import { pastedTable } from '@/engine/shared-doc-logic';
import { csvSheet } from '@/files/sheet';

const rows = [
  'month\tteam\titem\tcost',
  'March\tGarden club\tSeeds\t$12.50',
  'March\tGarden club\tCompost\t$30.00',
  'March\tChess club\tBoards\t$45.25',
];

test('a pasted block of tab-separated lines is a table; the words around it are the question', () => {
  const r = pastedTable(['How much did each team spend?', ...rows, 'Thanks!'].join('\n'));
  expect(r?.table).toBe(rows.join('\n'));
  expect(r?.question).toBe('How much did each team spend?\nThanks!');
});

test('words typed on the first line before the cells are the question, not a header', () => {
  const text = [`Cost per team, please: ${rows[0]}`, ...rows.slice(1)].join('\n');
  const r = pastedTable(text);
  expect(r?.question).toBe('Cost per team, please:');
  expect(r?.table.split('\n')[0]).toBe(rows[0]);
  // The cells read as a sheet with numbers.
  const sheet = csvSheet(r!.table, 'Pasted table', false, '\t');
  expect(sheet.rows[0]).toEqual(['month', 'team', 'item', 'cost']);
  expect(sheet.rows).toHaveLength(4);
});

test('ordinary questions, and one or two tabbed lines, are not tables', () => {
  expect(pastedTable('What is the capital of Canada?')).toBeNull();
  expect(pastedTable('Write a, b, c\nand d, e, f\nand g, h, i')).toBeNull();
  expect(pastedTable(`Sum these\n${rows[0]}\n${rows[1]}`)).toBeNull();
});

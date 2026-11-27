import { Conversation } from '@/engine/conversation';
import { ANSWER_STYLE_MAX, questionPart, SYSTEM_PROMPT, withAnswerStyle } from '@/engine/prompts';
import { forSpeech } from '@/engine/sentences';
import { type ChatMessage, lastExchange, withoutExchange } from '@/features/ask/chat-logic';
import { factPrompt, parseSensitive, sensitiveCheckPrompt } from '@/memory/fact-extraction';
import { parseInline, parseMarkdown } from '@/ui/markdown-logic';

// --- Edit and Try again: the last exchange only ---

const q = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'user',
  text: 'How do I make pancakes?',
  at: 1,
  ...extra,
});
const a = (id: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  text: 'Mix flour, eggs and milk.',
  at: 1,
  momentId: 7,
  ...extra,
});

test('the last saved model answer and its question can be redone', () => {
  const msgs = [q('u1'), a('a1', { momentId: 3 }), q('u2'), a('a2')];
  const x = lastExchange(msgs);
  expect(x?.question.id).toBe('u2');
  expect(x?.reply.id).toBe('a2');
  expect(withoutExchange(msgs, x!).map((m) => m.id)).toEqual(['u1', 'a1']);
});

test.each<[string, ChatMessage[]]>([
  ['still being written', [q('u'), a('a', { pending: true })]],
  ['a rule reply (nothing saved)', [q('u'), a('a', { momentId: undefined })]],
  ['a draft card', [q('u'), a('a', { draftId: 'd1' })]],
  ['off the record', [q('u', { offRecord: true }), a('a', { offRecord: true })]],
  [
    'a photo question',
    [q('u', { media: [{ momentAt: 1, kind: 'photo', path: '/p.jpg' }] }), a('a')],
  ],
  ['an answer that is not last', [q('u'), a('a'), { ...a('in'), role: 'assistant' }, q('u2')]],
  ['empty chat', []],
])('no Edit / Try again for %s', (_, msgs) => {
  expect(lastExchange(msgs)).toBeNull();
});

test('taking back the last turn: gone from the chat, and the model starts a fresh chat', () => {
  const c = new Conversation({ summary: '', turns: [] });
  c.record('first', 'one', 100, 1000);
  c.started(400);
  c.record('second', 'two', 100, 2000);
  expect(c.keepHistory()).toBe(true);
  expect(c.dropLast('two')).toBe(true);
  expect(c.state.turns.map((t) => t.q)).toEqual(['first']);
  expect(c.keepHistory()).toBe(false); // the old answer is not in the next model chat
  expect(c.idleFor(3000)).toBe(2000);
});

test('a different last answer is left alone (the chat still restarts)', () => {
  const c = new Conversation({ summary: '', turns: [{ q: 'x', a: 'y', at: 1 }] });
  c.started(100);
  expect(c.dropLast('something else')).toBe(false);
  expect(c.state.turns).toHaveLength(1);
  expect(c.keepHistory()).toBe(false);
});

// --- How Sidekick answers ---

test("the user's own instructions join the chat prompt, trimmed and capped", () => {
  expect(withAnswerStyle(SYSTEM_PROMPT, '')).toBe(SYSTEM_PROMPT);
  expect(withAnswerStyle(SYSTEM_PROMPT, '  ')).toBe(SYSTEM_PROMPT);
  const p = withAnswerStyle(SYSTEM_PROMPT, '  call me Rob,\n metric units ');
  expect(p.startsWith(SYSTEM_PROMPT)).toBe(true);
  expect(p).toContain('How the user wants you to answer: call me Rob, metric units');
  const long = withAnswerStyle('', 'x'.repeat(1000));
  expect(long.length).toBeLessThan(ANSWER_STYLE_MAX + 50);
});

// --- Formatted answers ---

test('typed answers may use markdown; spoken ones are marked plain', () => {
  expect(SYSTEM_PROMPT).toContain('markdown');
  expect(SYSTEM_PROMPT).not.toContain('no lists or markdown');
  const now = new Date(2026, 10, 26, 12);
  expect(questionPart('a recipe for scones', now)).toMatch(/\nQuestion: a recipe for scones$/);
  expect(questionPart('a recipe for scones', now, true)).toMatch(
    /\nQuestion \(spoken\): a recipe for scones$/,
  );
});

test('a recipe: heading, steps, bullets and bold', () => {
  const b = parseMarkdown(
    '## Scones\n\nYou need:\n- 225 g **self-raising** flour\n- 55 g butter\n\n1. Heat the oven.\n2. Rub in the butter.',
  );
  expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'item', 'item', 'item', 'item']);
  expect(b[2]).toEqual({
    kind: 'item',
    marker: '•',
    indent: 0,
    spans: [{ text: '225 g ' }, { text: 'self-raising', bold: true }, { text: ' flour' }],
  });
  expect(b[5]).toMatchObject({ marker: '2.', spans: [{ text: 'Rub in the butter.' }] });
});

test('a small table', () => {
  const b = parseMarkdown('| Plan | Price |\n|---|---:|\n| Basic | £5 |\n| Pro | £9 |\nDone.');
  expect(b[0]).toEqual({
    kind: 'table',
    header: [[{ text: 'Plan' }], [{ text: 'Price' }]],
    rows: [
      [[{ text: 'Basic' }], [{ text: '£5' }]],
      [[{ text: 'Pro' }], [{ text: '£9' }]],
    ],
  });
  expect(b[1]).toEqual({ kind: 'para', spans: [{ text: 'Done.' }] });
});

test('plain answers stay one paragraph; pipes without a rule line are text', () => {
  expect(parseMarkdown('It is 12 degrees.\nTake a coat.')).toEqual([
    { kind: 'para', spans: [{ text: 'It is 12 degrees.\nTake a coat.' }] },
  ]);
  expect(parseMarkdown('a | b')[0].kind).toBe('para');
});

test('inline marks; unfinished marks while streaming are hidden, not shown as stars', () => {
  expect(parseInline('a *b* and `c`')).toEqual([
    { text: 'a ' },
    { text: 'b', italic: true },
    { text: ' and ' },
    { text: 'c' },
  ]);
  expect(parseInline('Step **one')).toEqual([{ text: 'Step one' }]);
  expect(parseInline('3 * 4 = 12')).toEqual([{ text: '3 * 4 = 12' }]);
  expect(parseInline('snake_case_name')).toEqual([{ text: 'snake_case_name' }]);
});

test('read aloud: list bullets and table pipes are not spoken', () => {
  expect(forSpeech('- 225 g **flour**')).toBe('225 g flour');
  expect(forSpeech('1. Heat the oven.')).toBe('1. Heat the oven.');
  expect(forSpeech('| Basic | £5 |')).toBe('Basic, £5');
  expect(forSpeech('|---|---:|')).toBe('');
});

// --- Private facts are not suggested ---

test('owner facts: private topics are left out unless allowed', () => {
  expect(factPrompt(['my code is 4512'])).toContain(
    'Leave out anything about health, religion or beliefs, sexuality, politics or money.',
  );
  expect(factPrompt(['my code is 4512'], true)).not.toContain('Leave out');
});

test('person facts: the model says which lines are private', () => {
  const p = sensitiveCheckPrompt(['I live in Leeds', 'I am diabetic']);
  expect(p).toContain('1. I live in Leeds\n2. I am diabetic');
  expect(parseSensitive('2', 2)).toEqual(new Set([1]));
  expect(parseSensitive('1, 2.', 2)).toEqual(new Set([0, 1]));
  expect(parseSensitive('NONE', 2)).toEqual(new Set());
  expect(parseSensitive('None of them.', 2)).toEqual(new Set());
  // Out of range or no answer: unclear, so every line counts as private.
  expect(parseSensitive('7', 2)).toBeNull();
  expect(parseSensitive('I am not sure', 2)).toBeNull();
});

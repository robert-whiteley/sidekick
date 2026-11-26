import {
  chatSystem,
  compact,
  Conversation,
  fitQuestion,
  FOLLOW_UP_MS,
  historyBudgetTokens,
  MAX_QUESTION_CHARS,
  IDLE_COMPACT_MS,
  isContextFull,
  isNaturalEnd,
  KEEP_VERBATIM,
  parseSummary,
  summaryPrompt,
  SUMMARY_INPUT_CHARS,
  type CompactDeps,
} from '../src/engine/conversation';
import { parseChatState } from '../src/memory/chat-state';

jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));

const turn = (c: Conversation, q: string, at: number, promptChars = 400) =>
  c.record(q, `answer to ${q}`, promptChars, at);

test('the first question starts a fresh chat, later ones continue it', () => {
  const c = new Conversation();
  expect(c.keepHistory()).toBe(false);
  c.started(800);
  turn(c, 'a', 1000);
  expect(c.keepHistory()).toBe(true);
  // Long after: still the same chat (no per-question reset any more).
  expect(c.keepHistory()).toBe(true);
});

test('a spoken follow-up is one said over or within the window after an answer', () => {
  const c = new Conversation();
  c.answered(1000);
  expect(c.isFollowUp(false, 1000 + FOLLOW_UP_MS)).toBe(true);
  expect(c.isFollowUp(false, 1001 + FOLLOW_UP_MS)).toBe(false);
  expect(c.isFollowUp(true, 60_000)).toBe(true);
});

test('natural ends', () => {
  for (const s of [
    "I'm going out now",
    "That's all for now",
    'bye',
    'OK, goodnight!',
    "thanks, that's it",
    'talk to you later',
    "I'm off to bed",
  ])
    expect([s, isNaturalEnd(s)]).toEqual([s, true]);
  for (const s of [
    'What time does the bus leave?',
    'Is that all the milk we have?',
    'Who said bye to Sam yesterday?',
    "I'm going out with Sam on Friday, remind me",
  ])
    expect([s, isNaturalEnd(s)]).toEqual([s, false]);
});

test('compaction is due on size, natural end, or 10 minutes idle', () => {
  const c = new Conversation(undefined, 500);
  c.started(400);
  turn(c, 'one', 0, 400);
  expect(c.compactReason(1)).toBeNull();
  turn(c, 'two', 1, 2000);
  expect(c.compactReason(2)).toBe('size');

  const d = new Conversation(undefined, 99_999);
  d.started(100);
  turn(d, 'a', 0);
  turn(d, 'b', 1);
  expect(d.compactReason(IDLE_COMPACT_MS)).toBeNull(); // only the verbatim turns: nothing to summarise
  turn(d, 'c', 2);
  expect(d.compactReason(1 + IDLE_COMPACT_MS)).toBeNull();
  expect(d.compactReason(2 + IDLE_COMPACT_MS)).toBe('idle');
  expect(d.compactReason(3, "I'm going out")).toBe('end');
});

test('a fresh chat starts from the summary and the last turns word for word', () => {
  const sys = chatSystem('BASE', {
    summary: 'Talked about the bus to town.',
    turns: [
      { q: 'old', a: 'old answer', at: 0 },
      { q: 'When is the next bus?', a: 'At 10:15.', at: 1 },
      { q: 'And after that?', a: 'At 10:45.', at: 2 },
    ],
  });
  expect(sys.startsWith('BASE')).toBe(true);
  expect(sys).toContain('Talked about the bus to town.');
  expect(sys).toContain('User: And after that?\nYou: At 10:45.');
  expect(sys).toContain('When is the next bus?');
  expect(sys).not.toContain('old answer');
  expect(chatSystem('BASE', { summary: '', turns: [] })).toBe('BASE');
});

function deps(reply: string | (() => string), over?: Partial<CompactDeps>) {
  const saved: unknown[] = [];
  const prepared: string[] = [];
  const d: CompactDeps = {
    summarise: async () => (typeof reply === 'string' ? reply : reply()),
    preemptions: () => 0,
    save: (s) => saved.push(structuredClone(s)),
    prepare: (s) => prepared.push(s),
    ...over,
  };
  return { d, saved, prepared };
}

test('compaction folds the older turns into the summary and restarts the chat', async () => {
  const c = new Conversation();
  c.started(100);
  for (const q of ['a', 'b', 'c', 'd']) turn(c, q, 1);
  const { d, saved, prepared } = deps('Summary: The user asked a, b.');
  expect(await compact(c, d, 'BASE')).toBe(true);
  expect(c.state.summary).toBe('The user asked a, b.');
  expect(c.state.turns.map((t) => t.q)).toEqual(['c', 'd']);
  expect(c.state.turns).toHaveLength(KEEP_VERBATIM);
  expect(c.keepHistory()).toBe(false);
  expect(saved).toHaveLength(1);
  expect(prepared[0]).toContain('The user asked a, b.');
});

test('a question that interrupts the summary leaves everything as it was', async () => {
  const c = new Conversation();
  c.started(100);
  for (const q of ['a', 'b', 'c']) turn(c, q, 1);
  let n = 0;
  const { d, saved } = deps(
    () => {
      n++;
      return 'The user asked a';
    },
    { preemptions: () => n },
  );
  expect(await compact(c, d, 'BASE')).toBe(false);
  expect(c.state.turns).toHaveLength(3);
  expect(c.keepHistory()).toBe(true);
  expect(saved).toHaveLength(0);
});

test('an empty summary is not used', async () => {
  const c = new Conversation();
  c.started(100);
  for (const q of ['a', 'b', 'c']) turn(c, q, 1);
  expect(await compact(c, deps('  ').d, 'BASE')).toBe(false);
  expect(c.state.turns).toHaveLength(3);
});

test('a chat too big with only the last turns restarts without the model', async () => {
  const c = new Conversation(undefined, 100);
  c.started(100);
  turn(c, 'huge', 1, 5000);
  let asked = false;
  const { d } = deps(() => {
    asked = true;
    return 'x';
  });
  expect(await compact(c, d, 'BASE')).toBe(true);
  expect(asked).toBe(false);
  expect(c.keepHistory()).toBe(false);
  expect(c.state.turns).toHaveLength(1);
});

test('summary prompt and parsing', () => {
  const p = summaryPrompt('Before.', [{ q: 'Q1', a: 'A1', at: 0 }]);
  expect(p).toContain('Summary so far: Before.');
  expect(p).toContain('User: Q1\nAssistant: A1');
  expect(parseSummary('Updated summary:  The user  is going to town.')).toBe(
    'The user is going to town.',
  );
  expect(parseSummary('ok')).toBeNull();
});

test('smaller phones compact sooner', () => {
  expect(historyBudgetTokens(4096)).toBeLessThan(historyBudgetTokens(8192));
  expect(historyBudgetTokens(8192)).toBeLessThan(historyBudgetTokens(12_288));
});

test('saved chat state survives junk', () => {
  expect(parseChatState(null)).toEqual({ summary: '', turns: [] });
  expect(parseChatState('{bad')).toEqual({ summary: '', turns: [] });
  expect(
    parseChatState(JSON.stringify({ summary: 'S', turns: [{ q: 'a', a: 'b', at: 1 }, { q: 1 }] })),
  ).toEqual({ summary: 'S', turns: [{ q: 'a', a: 'b', at: 1 }] });
});

test('reset forgets everything', () => {
  const c = new Conversation({ summary: 'S', turns: [{ q: 'a', a: 'b', at: 1 }] });
  c.started(10);
  c.reset();
  expect(c.state).toEqual({ summary: '', turns: [] });
  expect(c.keepHistory()).toBe(false);
});

test('a chat that would overflow the model restarts from the summary instead', () => {
  const c = new Conversation(undefined, 2500);
  expect(c.fitOrRestart(100_000)).toBe(false); // a fresh chat has nothing to drop
  c.started(800);
  // Compaction kept being interrupted: the chat grew past the budget.
  for (let i = 0; i < 8; i++) turn(c, `q${i}`, i, 1500);
  expect(c.usedTokens()).toBeGreaterThan(2500);
  expect(c.fitOrRestart(400)).toBe(true);
  expect(c.keepHistory()).toBe(false);
  // The turns stay for the summary and the next fresh chat's last exchanges.
  expect(c.state.turns).toHaveLength(8);
});

test('a small chat keeps going', () => {
  const c = new Conversation(undefined, 2500);
  c.started(800);
  turn(c, 'a', 1, 400);
  expect(c.fitOrRestart(400)).toBe(false);
  expect(c.keepHistory()).toBe(true);
});

test('the summary pass reads only the newest older turns when there are many', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({
    q: `question ${i} ${'x'.repeat(80)}`,
    a: `answer ${i}`,
    at: i,
  }));
  const p = summaryPrompt('', many);
  expect(p.length).toBeLessThan(SUMMARY_INPUT_CHARS + 500);
  expect(p).toContain('question 199');
  expect(p).not.toContain('question 0 ');
  // One huge turn is cut, not dropped.
  expect(summaryPrompt('', [{ q: 'y'.repeat(20_000), a: 'ok', at: 0 }]).length).toBeLessThan(
    SUMMARY_INPUT_CHARS + 500,
  );
});

test('the model saying its chat is full is recognised', () => {
  expect(
    isContextFull(new Error('Max number of tokens reached, the context window is full.')),
  ).toBe(true);
  expect(
    isContextFull(
      'Input token ids are too long. Exceeding the maximum number of tokens allowed: 4096',
    ),
  ).toBe(true);
  expect(isContextFull(new Error('Status Code: 13. Message: Task failed with state: 7'))).toBe(
    true,
  );
  expect(isContextFull(new Error('Task failed with state: 8'))).toBe(false);
  expect(isContextFull(new Error('Model not loaded'))).toBe(false);
});

test('a paste too long for the model keeps its start and end', () => {
  expect(fitQuestion('short')).toBe('short');
  const long = `BEGIN ${'word '.repeat(5000)} FINISH`;
  const f = fitQuestion(long);
  expect(f.length).toBeLessThan(MAX_QUESTION_CHARS + 100);
  expect(f.startsWith('BEGIN')).toBe(true);
  expect(f.endsWith('FINISH')).toBe(true);
  expect(f).toContain('characters left out');
});

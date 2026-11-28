import {
  catalogSystem,
  DECIDE_EXAMPLES,
  decidePrompt,
  DECIDE_TOOLS,
  decideHint,
  decisionLabel,
  lockSafe,
  parseClassify,
  parseDecision,
  wantsThinking,
} from '../src/engine/decide-logic';
import {
  argExample,
  escapeInnerQuotes,
  fillPrompt,
  fillRetryPrompt,
  parseFillReply,
  requiredExample,
  toolByName,
  TOOLS,
} from '../src/engine/tools-logic';

// The schema refused "stop listening" ({"listening": false}), "bring the volume down"
// ({"volume": "down"}), "switch on do not disturb" and "say good night in Italian" (no language),
// and the retry repeated the same shape. The retry now lists the arguments one per line
// (laptop, 150 argument calls: 141 → 146 right after the retry; the first try is unchanged).
describe('the retry after a refused call', () => {
  it('lists every argument of every tool, marked required or optional, with no signature', () => {
    for (const t of TOOLS) {
      const p = fillRetryPrompt('q', new Date(2026, 10, 28), t, 'x missing');
      expect(p).toContain(`Tool ${t.name}, to ${t.desc}.`);
      expect(p).not.toContain(`${t.name}(`);
      for (const [n, a] of Object.entries(t.args))
        expect(p).toMatch(
          new RegExp(`\\n- ${n}: .*, ${a.required ? 'required' : 'optional'}(\\n|$)`),
        );
      const ex = JSON.parse(requiredExample(t)) as Record<string, unknown>;
      for (const [n, a] of Object.entries(t.args)) if (a.required) expect(ex).toHaveProperty(n);
    }
  });
  it('shows the required arguments in its example (translate: the language)', () => {
    expect(requiredExample(toolByName('translate')!)).toBe('{"to": "..."}');
    expect(requiredExample(toolByName('phone_setting')!)).toBe('{"setting": "torch"}');
    expect(requiredExample(toolByName('message')!)).toMatch(/^\{"to": "\.\.\.", "\w+": /);
  });
  it('says what the media choices mean, so "skip" is next', () => {
    expect(fillPrompt('skip this song', new Date(2026, 10, 28), toolByName('media')!)).toContain(
      'next skips to the next track',
    );
  });
});

describe('parseDecision (bench variant)', () => {
  it('reads a DO marker naming a known tool', () => {
    expect(parseDecision('DO timer')).toEqual({ kind: 'do', tool: 'timer' });
    expect(parseDecision(' do Alarm.')).toEqual({ kind: 'do', tool: 'alarm' });
    expect(parseDecision('**DO calculate**')).toEqual({ kind: 'do', tool: 'calculate' });
  });
  it('treats anything else as an answer', () => {
    expect(parseDecision('DO pizza')).toEqual({ kind: 'answer' });
    expect(parseDecision('Do you want me to set a timer?')).toEqual({ kind: 'answer' });
    expect(parseDecision(`DO timer ${'x'.repeat(80)}`)).toEqual({ kind: 'answer' });
    expect(parseDecision('Paris is the capital of France.')).toEqual({ kind: 'answer' });
  });
  it('reads LOOKUP', () => {
    expect(parseDecision('LOOKUP')).toEqual({ kind: 'lookup' });
    expect(parseDecision("I'm not sure. LOOKUP")).toEqual({ kind: 'lookup' });
  });
});

describe('the sorter reply', () => {
  it('reads one word', () => {
    expect(parseClassify('timer')).toEqual({ kind: 'do', tool: 'timer' });
    expect(parseClassify('Lookup.')).toEqual({ kind: 'lookup' });
    expect(parseClassify('news')).toEqual({ kind: 'lookup', news: true });
    expect(parseClassify('banana')).toEqual({ kind: 'answer' });
    // An answer from the owner's memories (searched by meaning even on a small phone).
    expect(parseClassify('memory')).toEqual({ kind: 'answer', memory: true });
    expect(parseClassify('Memory_search')).toEqual({ kind: 'answer', memory: true });
    expect(catalogSystem()).toMatch(/^memory: a question about my own life/m);
    expect(decisionLabel({ kind: 'answer', memory: true })).toBe('answer');
    // A tool's main choice instead of its name (the sorter said "upscale" on the phone).
    expect(parseClassify('upscale')).toEqual({ kind: 'do', tool: 'edit_photo' });
    expect(parseClassify('torch')).toEqual({ kind: 'do', tool: 'phone_setting' });
    expect(parseClassify('')).toEqual({ kind: 'answer' });
    expect(decisionLabel({ kind: 'do', tool: 'timer' })).toBe('do:timer');
  });
  it('finds a tool name inside a joined word', () => {
    expect(parseClassify('stop_listening')).toEqual({ kind: 'do', tool: 'listening' });
  });
  it('only names tools it was offered', () => {
    const noDraft = DECIDE_TOOLS.filter((t) => t.name !== 'draft');
    expect(parseClassify('draft', noDraft)).toEqual({ kind: 'answer' });
    expect(parseClassify('draft')).toEqual({ kind: 'do', tool: 'draft' });
  });
  it('names tools that act or read the phone, and recaps', () => {
    expect(DECIDE_TOOLS.every((t) => t.kind !== 'answer' || t.name === 'recap')).toBe(true);
    expect(decideHint()).toContain('calculate');
  });
});

describe('the sorter prompt', () => {
  it('lists every tool given, and lookup and news only when offered', () => {
    const tools = DECIDE_TOOLS.slice(0, 5);
    const on = catalogSystem(tools, true);
    for (const t of tools) expect(on).toContain(`${t.name}: ${t.desc}`);
    expect(on).toMatch(/^lookup: /m);
    expect(on).toMatch(/^news: /m);
    const off = catalogSystem(tools, false);
    expect(off).not.toMatch(/^lookup: /m);
    expect(off).not.toMatch(/^news: /m);
  });
});

describe('the call line', () => {
  it('says it is a phone call, so talking to someone face to face is not sent to it', () => {
    // "Phone someone" made the sorter pick call for a shop assistant who speaks Japanese, and the
    // call tool then asked for contacts access.
    expect(catalogSystem()).toMatch(/^call: .*phone call/m);
  });
});

describe('with the phone locked', () => {
  it('runs only what says nothing personal', () => {
    for (const t of ['timer', 'alarm', 'calculate', 'speech_speed', 'camera', 'find_phone'])
      expect([t, lockSafe(t, {})]).toEqual([t, true]);
    for (const t of ['message', 'call', 'texts', 'calls', 'draft', 'read_messages'])
      expect([t, lockSafe(t, {})]).toEqual([t, false]);
    expect(lockSafe('phone_setting', { setting: 'torch' })).toBe(true);
    expect(lockSafe('phone_setting', { setting: 'brightness' })).toBe(false);
    expect(lockSafe('phone_info', { what: 'battery' })).toBe(true);
    expect(lockSafe('phone_info', { what: 'storage' })).toBe(false);
    expect(lockSafe('listening', { on: false })).toBe(true);
    expect(lockSafe('listening', { on: true })).toBe(false);
  });
});

describe('filling one tool', () => {
  it('shows only that tool and lets the model decline', () => {
    const timer = toolByName('timer')!;
    const p = fillPrompt('five minutes on the clock', new Date(2026, 10, 26, 14, 30), timer);
    expect(p).toContain('Tool: timer(');
    expect(p).toContain('{"none":true}');
    expect(p).toContain('"five minutes on the clock"');
    for (const t of TOOLS.filter((x) => x.name !== 'timer')) expect(p).not.toContain(`${t.name}(`);
  });
  it('shows the reply shape keyed by argument names (edit_photo: {"op": …})', () => {
    // The model wrote {"crop":"square"} without it, so every photo edit was refused.
    const edit = toolByName('edit_photo')!;
    expect(fillPrompt('crop it square', new Date(2026, 10, 27), edit)).toContain(
      'for example {"op": "rotate"}',
    );
    expect(argExample(toolByName('timer')!)).toMatch(/^\{"\w+": /);
    for (const t of TOOLS) expect(() => JSON.parse(argExample(t))).not.toThrow();
  });
  it('reads the model’s {"tool_name", "arguments"} shape', () => {
    expect(
      parseFillReply(
        '```json\n{"tool_name":"edit_photo","arguments":{"op":"crop","shape":"square"}}\n```',
        'edit_photo',
      ),
    ).toEqual({ tool: 'edit_photo', args: { op: 'crop', shape: 'square' } });
  });
  it('reads the arguments under the tool’s own name', () => {
    // Seen on the phone for "Stop listening".
    expect(parseFillReply('{"listening":{"on":false}}', 'listening')).toEqual({
      tool: 'listening',
      args: { on: false },
    });
    // A lone argument that shares the tool's name is still an argument.
    expect(parseFillReply('{"timer":5}', 'timer')).toEqual({ tool: 'timer', args: { timer: 5 } });
  });
  it('tells the sorter alarms and reminders are not calendar events', () => {
    const sys = catalogSystem(DECIDE_TOOLS);
    expect(sys).toMatch(/^event: .*not an alarm or a reminder/m);
    expect(sys).toMatch(/^reminder: .*that is routine/m);
    expect(sys).toMatch(/^phone_setting: .*not the camera or listening/m);
    expect(fillPrompt('90 seconds', new Date(2026, 10, 27), toolByName('timer')!)).toContain(
      '1.5 for 90 seconds',
    );
  });
  it('reads bare arguments, the router shape, none, and refuses junk', () => {
    expect(parseFillReply('{"minutes":5}', 'timer')).toEqual({
      tool: 'timer',
      args: { minutes: 5 },
    });
    expect(parseFillReply('```json\n{"tool":"timer","args":{"minutes":5}}\n```', 'timer')).toEqual({
      tool: 'timer',
      args: { minutes: 5 },
    });
    expect(parseFillReply('{"none":true}', 'timer')).toEqual({ tool: 'none', args: {} });
    expect(parseFillReply('{"tool":"none"}', 'timer')).toEqual({ tool: 'none', args: {} });
    expect(parseFillReply('five minutes', 'timer')).toBeNull();
    expect(parseFillReply('{"minutes":', 'timer')).toBeNull();
  });
});

describe('thinking hand-off marker', () => {
  it('is THINK alone', () => {
    expect(wantsThinking('THINK')).toBe(true);
    expect(wantsThinking(' **think.** ')).toBe(true);
    expect(wantsThinking('I think it is Paris.')).toBe(false);
    // Seen on the phone: the marker, then the model's own working.
    expect(wantsThinking('THINK The user is asking a simple subtraction problem.')).toBe(true);
    expect(wantsThinking('Think of a number between 1 and 10.')).toBe(false);
  });
});

describe('decidePrompt', () => {
  it('is the request alone when there was no recent exchange', () => {
    expect(decidePrompt('Set a timer for five minutes')).toBe(
      'Request: Set a timer for five minutes',
    );
  });
  it('puts a recent exchange before a short reply, so "yes" is read with what it answers', () => {
    const p = decidePrompt('Yes', {
      q: 'Is the museum in town open on Mondays?',
      a: "I don't know its opening hours. I can look that up if you like.",
    });
    expect(p).toContain('I asked "Is the museum in town open on Mondays?"');
    expect(p).toContain('I can look that up if you like.');
    expect(p.endsWith('\nRequest: Yes')).toBe(true);
  });
  it('clips a long earlier exchange', () => {
    const p = decidePrompt('ok', { q: 'q'.repeat(500), a: 'a'.repeat(900) });
    expect(p.length).toBeLessThan(560);
  });
});

// The sorter's prompt after PR 64 (laptop, the app's Gemma, all 202 bench items, classify only:
// 170 -> 176). Its near-miss items flipped on small wording changes; these are the lines that
// moved them back: "explain how GPS works" or "a good recipe" picked research, "what is an alarm
// clock" picked alarm, and "set an alarm" picked reminder, whose line named alarms.
test('the sorter keeps research for a research request and talk about a tool as an answer', () => {
  const sys = catalogSystem();
  expect(sys).toMatch(/^research: only when I ask you to research a topic/m);
  expect(sys).toMatch(/^answer: .*about what a tool below does \(what it is or how it works\)/m);
  expect(sys).toMatch(
    /phone tool that does what I ask \(only when I want the phone to do that now\)/,
  );
  expect(sys).not.toMatch(/^reminder: .*alarm/m);
});

// About a fifth of the bench sat at the edge with the tool lines alone, so each new line flipped
// others. Worked examples of the near pairs settle them (laptop, all 202 items: 176 -> 191, the
// 41 held out of tuning 35 -> 40), and "Is my passport still valid?" is no longer a web search.
describe('the sorter examples', () => {
  it('follow the catalog, each reply a word the sorter reads', () => {
    const sys = catalogSystem();
    expect(sys).toContain('\nExamples:\nRequest: ');
    for (const [q, a] of DECIDE_EXAMPLES) {
      expect(sys).toContain(`Request: ${q}\n${a}`);
      const d = parseClassify(a);
      expect(decisionLabel(d)).toBe(
        a === 'memory'
          ? 'answer'
          : a === 'news'
            ? 'lookup'
            : a === 'answer' || a === 'lookup'
              ? a
              : `do:${a}`,
      );
    }
  });

  it('leave out the examples for a tool or a lookup that is not offered', () => {
    const tools = DECIDE_TOOLS.filter((t) => t.name !== 'alarm');
    const sys = catalogSystem(tools, false);
    expect(sys).not.toContain('Ring at 5:45 tomorrow so I wake up');
    expect(sys).not.toMatch(/^(lookup|news)$/m);
    expect(sys).toContain('Request: Remind me to call the bank at 3\nreminder');
  });

  it('are not bench lines', () => {
    const { CASES } = jest.requireActual('../bench/answers/cases');
    const { DECIDE_CASES } = jest.requireActual('../bench/answers/decide-cases');
    const bench = new Set([...CASES, ...DECIDE_CASES].map((c: { q: string }) => c.q.toLowerCase()));
    for (const [q] of DECIDE_EXAMPLES) expect(bench.has(q.toLowerCase())).toBe(false);
  });
});

// The model writes formulas with bare quotes inside the JSON string; that failed as "not JSON".
test('reads a reply whose string values hold bare quotes', () => {
  expect(
    parseFillReply('```json\n{\n  "formula": "=COUNTIFS(C:C, ">10")"\n}\n```', 'query_sheet'),
  ).toEqual({ tool: 'query_sheet', args: { formula: '=COUNTIFS(C:C, ">10")' } });
  expect(
    parseFillReply('{"formula": "=SUMIFS([Cost],[Team],"Red")", "label": "Red"}', 'query_sheet'),
  ).toEqual({
    tool: 'query_sheet',
    args: { formula: '=SUMIFS([Cost],[Team],"Red")', label: 'Red' },
  });
  expect(parseFillReply('{"formula": "=SUMIFS(C:C, A:A, \\"Red\\")"}', 'query_sheet')).toEqual({
    tool: 'query_sheet',
    args: { formula: '=SUMIFS(C:C, A:A, "Red")' },
  });
  expect(escapeInnerQuotes('{"a": 1}')).toBe('{"a": 1}');
});

// "Stop the interpreter": the sorter said "stop", media's choice, so the music was stopped.
test('a choice word that other tool lines also use is not read as that tool', () => {
  expect(parseClassify('stop')).toEqual({ kind: 'answer' });
  expect(parseClassify('upscale')).toEqual({ kind: 'do', tool: 'edit_photo' });
});

test('the sorter has an example for the interpreter and for deleting what Sidekick kept', () => {
  const sys = catalogSystem();
  expect(sys).toContain('Request: Close the interpreter\ninterpreter');
  expect(sys).toContain('Request: Delete everything from today\napp_setting');
  expect(sys).toMatch(/^app_setting: .*delete what Sidekick kept/m);
});

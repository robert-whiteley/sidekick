import {
  catalogSystem,
  DECIDE_TOOLS,
  decideHint,
  decisionLabel,
  lockSafe,
  parseClassify,
  parseDecision,
  wantsThinking,
} from '../src/engine/decide-logic';
import { fillPrompt, parseFillReply, toolByName, TOOLS } from '../src/engine/tools-logic';

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
  });
});

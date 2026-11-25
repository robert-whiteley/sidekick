/** The model tool router: which tools are offered, how calls are checked, and the chain loop. */
import { planIntent } from '@/engine/actions';
import { parseFeedback } from '@/engine/feedback';
import { feedbackRule, locationPhrase, resolveTimeWithModel, routeWithTools } from '@/engine/tools';
import {
  parseRangeReply,
  parseToolReply,
  relevantTools,
  validateCall,
  wantsModelRange,
} from '@/engine/tools-logic';
import { forgetRanges, parseTimeRange } from '@/memory/time-range';

// jest hoists these above the imports.
jest.mock('@/engine/llm', () => ({ askLlm: jest.fn() }));
jest.mock('@/engine/actions', () => ({ planIntent: jest.fn() }));
jest.mock('@/engine/voice-commands', () => ({ runParsedCommand: jest.fn() }));
jest.mock('@/integrations/extras', () => ({ runExtra: jest.fn() }));
jest.mock('@/integrations/phone-controls', () => ({ runControl: jest.fn() }));
jest.mock('@/integrations/prefs', () => ({ isOn: jest.fn(() => true) }));
jest.mock('@/memory/store', () => ({ searchMemory: jest.fn(async () => []) }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { support: { email: 'support@example.com' } } } },
}));
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '2.0.0',
  nativeBuildVersion: '7',
}));

const NOW = new Date(2026, 10, 25, 12, 0);
const names = (q: string, o = {}) => relevantTools(q, o).map((t) => t.name);
const quiet = { log: () => {}, now: NOW };

/** A fake model that gives these replies in turn. */
const replies = (...r: string[]) => {
  const ask = jest.fn(
    async (_prompt: string, _system: string, _max: number) => r.shift() ?? '{"tool":"none"}',
  );
  return ask;
};

beforeEach(() => {
  jest.mocked(planIntent).mockReset();
  forgetRanges();
});

describe('which tools are offered', () => {
  it('skips plain knowledge questions', () => {
    expect(names('what is the capital of France')).toEqual([]);
    expect(names('why is the sky blue')).toEqual([]);
  });
  it('offers the tools the words point at', () => {
    expect(names('ping my sister that I will be late')).toContain('message');
    expect(names('could you wake me at seven')).toContain('alarm');
    expect(names('do I need an umbrella in Leeds tomorrow')[0]).toBe('weather');
  });
  it('offers everything for an unknown instruction, nothing for an unknown question', () => {
    expect(names('sort out the thing for Jo').length).toBeGreaterThan(10);
    expect(names('is it nice')).toEqual([]);
  });
  it('never offers reply first, nor routines in a routine or places off the record', () => {
    expect(names('sort out the thing for Jo')).not.toContain('reply');
    expect(names('every morning read my day', { routine: true })).not.toContain('routine');
    expect(names('call this spot the gym', { offRecord: true })).not.toContain('name_place');
  });
});

describe('checking a call', () => {
  it('reads JSON with or without fences and other key names', () => {
    expect(parseToolReply('```json\n{"tool":"timer","args":{"minutes":5}}\n```')).toEqual({
      tool: 'timer',
      args: { minutes: 5 },
    });
    expect(parseToolReply('{"name":"call","arguments":{"to":"Sam"}}')).toEqual({
      tool: 'call',
      args: { to: 'Sam' },
    });
    expect(parseToolReply('no idea')).toBeNull();
  });
  it('needs required arguments', () => {
    expect(validateCall({ tool: 'message', args: { to: 'Sam' } }).ok).toBe(false);
    expect(validateCall({ tool: 'message', args: { to: 'Sam', text: ' ' } }).ok).toBe(false);
  });
  it('turns numbers and booleans from text, and checks ranges', () => {
    expect(validateCall({ tool: 'timer', args: { minutes: '10' } })).toEqual({
      ok: true,
      args: { minutes: 10 },
    });
    expect(validateCall({ tool: 'timer', args: { minutes: 99999 } }).ok).toBe(false);
  });
  it('drops a wrong optional choice and unknown arguments, rejects unknown tools', () => {
    const v = validateCall({
      tool: 'message',
      args: { to: 'Sam', text: 'hi', app: 'pigeon', colour: 'red' },
    });
    expect(v).toEqual({ ok: true, args: { to: 'Sam', text: 'hi' } });
    expect(validateCall({ tool: 'launch_rocket', args: {} }).ok).toBe(false);
  });
});

describe('the router loop', () => {
  it('runs one action through the normal draft path', async () => {
    const plan = { kind: 'reply', text: 'Timer set for 5 minutes.' };
    jest.mocked(planIntent).mockResolvedValue(plan as never);
    const ask = replies('{"tool":"timer","args":{"minutes":5}}');
    const out = await routeWithTools('give me five minutes on the clock', { ...quiet, ask });
    expect(out).toEqual({ kind: 'plan', plan });
    expect(planIntent).toHaveBeenCalledWith({ type: 'timer', seconds: 300, label: '' }, NOW);
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('falls back to the normal answer on none, bad JSON or a bad call', async () => {
    for (const r of ['{"tool":"none"}', 'hmm', '{"tool":"message","args":{"to":"Sam"}}']) {
      const out = await routeWithTools('ping Sam', { ...quiet, ask: replies(r) });
      expect(out).toBeNull();
    }
    expect(planIntent).not.toHaveBeenCalled();
  });
  it('chains an info result into the next step', async () => {
    const plan = { kind: 'draft', draft: { id: 'd1', title: 'Text to Sam' } };
    jest.mocked(planIntent).mockResolvedValue(plan as never);
    const ask = replies(
      '{"tool":"weather","args":{"place":"Leeds","day":"tomorrow"}}',
      '{"tool":"message","args":{"to":"Sam","text":"Rain tomorrow, bring a coat"}}',
    );
    const viaRules = jest.fn(async () => 'Rain tomorrow in Leeds.');
    const out = await routeWithTools('check the forecast for Leeds and then text Sam about it', {
      ...quiet,
      ask,
      viaRules,
    });
    expect(viaRules).toHaveBeenCalledWith("what's the weather in Leeds tomorrow");
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][0]).toContain('Rain tomorrow in Leeds.');
    expect(out).toEqual({ kind: 'plan', plan });
  });
  it('stops after three steps and says the last result', async () => {
    const ask = jest.fn(async () => '{"tool":"weather","args":{"place":"Leeds"}}');
    const out = await routeWithTools('check the weather and then check it again', {
      ...quiet,
      ask,
      viaRules: async () => 'Sunny.',
    });
    expect(ask).toHaveBeenCalledTimes(3);
    expect(out).toEqual({ kind: 'reply', text: 'Sunny.' });
  });
  it('a single info request goes back through the rules', async () => {
    const out = await routeWithTools('umbrella needed in Leeds?', {
      ...quiet,
      ask: replies('{"tool":"weather","args":{"place":"Leeds"}}'),
    });
    expect(out).toEqual({ kind: 'rules', text: "what's the weather in Leeds" });
  });
});

describe('time spans the rules miss', () => {
  it('only asks for past questions with unusual time words', () => {
    expect(wantsModelRange('what did Jo say over Christmas', null)).toBe(true);
    expect(wantsModelRange('remind me at Christmas to call Jo', null)).toBe(false);
    expect(wantsModelRange('what did Jo say', null)).toBe(false);
    expect(wantsModelRange('what did Jo say over Christmas', { from: 1 })).toBe(false);
  });
  it('checks the model span and clips it to now', () => {
    const r = parseRangeReply(
      '{"from":"2025-12-24T00:00","to":"2027-01-01T00:00","label":"Christmas"}',
      NOW,
    );
    expect(r).toEqual({
      from: new Date(2025, 11, 24).getTime(),
      to: NOW.getTime(),
      label: 'Christmas',
    });
    expect(parseRangeReply('{"none":true}', NOW)).toBeNull();
    expect(parseRangeReply('{"from":"2026-11-20","to":"2026-11-10"}', NOW)).toBeNull();
    expect(parseRangeReply('{"from":"1990-01-01","to":"1990-02-01"}', NOW)).toBeNull();
  });
  it('remembers the span so every reader of that question uses it', async () => {
    const q = 'what did Jo say over Christmas';
    expect(parseTimeRange(q, NOW)).toBeNull();
    const ask = replies('{"from":"2025-12-24T00:00","to":"2025-12-27T00:00","label":"Christmas"}');
    await resolveTimeWithModel([q], { ask, now: NOW });
    expect(parseTimeRange(q, NOW)?.label).toBe('Christmas');
    forgetRanges();
    expect(parseTimeRange(q, NOW)).toBeNull();
  });
});

describe('feedback', () => {
  it('reads feedback requests', () => {
    expect(parseFeedback('send feedback: the camera is slow')).toBe('the camera is slow');
    expect(parseFeedback('tell the developers that I love it')).toBe('I love it');
    expect(parseFeedback('report a bug the timer froze')).toBe('the timer froze');
    expect(parseFeedback('what is feedback')).toBeNull();
  });
  it('drafts an email to support with the words and phone details', async () => {
    jest.mocked(planIntent).mockResolvedValue({ kind: 'draft', draft: { id: 'f' } } as never);
    await feedbackRule('send feedback: the camera is slow');
    const intent = jest.mocked(planIntent).mock.calls[0][0] as {
      name: string;
      subject: string;
      body: string;
    };
    expect(intent.name).toBe('support@example.com');
    expect(intent.subject).toBe('Sidekick feedback');
    expect(intent.body.startsWith('the camera is slow')).toBe(true);
    expect(intent.body).toContain('2.0.0');
  });
});

describe('location phrases', () => {
  it('turns the model choice into a phrase the rules know', () => {
    expect(locationPhrase('where_now', '', '')).toMatch(/where am i/i);
    expect(locationPhrase('parked', '', '')).toMatch(/park/i);
  });
});

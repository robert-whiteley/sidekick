/** Tool calls: how the model's arguments are checked, and what each tool does with them. */
import { planIntent, planTelephony } from '@/engine/actions';
import { fillTool, locationPhrase, resolveTimeWithModel, runTool } from '@/engine/tools';
import {
  parseRangeReply,
  parseToolReply,
  validateCall,
  wantsModelRange,
} from '@/engine/tools-logic';
import { forgetRanges, parseTimeRange } from '@/memory/time-range';

// jest hoists these above the imports.
jest.mock('@/engine/llm', () => ({ askLlm: jest.fn() }));
jest.mock('@/engine/interpreter', () => ({ openInterpreter: jest.fn(() => 'Interpreting') }));
jest.mock('@/engine/actions', () => ({
  planIntent: jest.fn(),
  planTelephony: jest.fn(),
  moveEventTo: jest.fn(),
  // The real one also stores the draft; here it only marks the send time.
  scheduleDraft: (plan: { kind: string; draft?: object } | null, at: number) =>
    plan?.kind === 'draft' ? { kind: 'draft', draft: { ...plan.draft, scheduledAt: at } } : plan,
}));
jest.mock('@/memory/sources', () => ({ contactDetails: jest.fn() }));
jest.mock('@/engine/quick-commands', () => ({ runParsedCommand: jest.fn() }));
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
  jest.mocked(planTelephony).mockReset();
  forgetRanges();
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

describe('running a tool', () => {
  it('turns a camera-setting call into the camera command', async () => {
    const { runParsedCommand } = jest.requireMock('@/engine/quick-commands') as {
      runParsedCommand: jest.Mock;
    };
    runParsedCommand.mockResolvedValue('Using the front camera.');
    const q = 'switch to the selfie camera and film more';
    const out = await runTool('camera_setting', { lens: 'front', frames: 'more' }, q, quiet, NOW);
    expect(out).toEqual({ kind: 'reply', text: 'Using the front camera.' });
    expect(runParsedCommand).toHaveBeenCalledWith(
      { type: 'cameraSetting', change: { frames: 'more', lens: 'front', detail: undefined } },
      q,
      null,
    );
  });
  it('runs an action through the normal draft path', async () => {
    const plan = { kind: 'reply', text: 'Timer set for 5 minutes.' };
    jest.mocked(planIntent).mockResolvedValue(plan as never);
    const out = await runTool('timer', { minutes: 5 }, 'five minutes on the clock', quiet, NOW);
    expect(out).toEqual({ kind: 'plan', plan });
    expect(planIntent).toHaveBeenCalledWith({ type: 'timer', seconds: 300, label: '' }, NOW);
  });
  it('translate with talk opens the interpreter; without, it translates the text', async () => {
    const talk = { text: '', to: 'Spanish', talk: true };
    expect(await runTool('translate', talk, 'help me talk to him', quiet, NOW)).toEqual({
      kind: 'reply',
      text: 'Interpreting',
    });
    expect(await runTool('translate', { text: 'hello', to: 'Spanish' }, 'q', quiet, NOW)).toEqual({
      kind: 'translate',
      text: 'hello',
      to: 'Spanish',
    });
  });
  it('play_recording answers normally with the heard clip asked for', async () => {
    expect(await runTool('play_recording', {}, 'play me that bit again', quiet, NOW)).toEqual({
      kind: 'answer',
      recording: true,
    });
  });
  it('sends a phone search to its handler with what, type, newest and time', async () => {
    const args = { what: 'invoice from Acme', type: 'file', newest: true, from: 1, to: 2 };
    expect(await runTool('find_on_phone', args, 'my latest Acme invoice', quiet, NOW)).toEqual({
      kind: 'find',
      req: { what: 'invoice from Acme', type: 'file', newest: true, from: 1, to: 2 },
    });
    expect(await runTool('find_on_phone', { what: 'x', type: 'video' }, 'q', quiet, NOW)).toEqual({
      kind: 'find',
      req: { what: 'x', type: 'any', newest: false },
    });
  });
  it('sends an info tool to its own handler as canonical words', async () => {
    const out = await runTool('weather', { place: 'Leeds' }, 'umbrella needed in Leeds?', quiet);
    expect(out).toEqual({ kind: 'rules', text: "what's the weather in Leeds" });
  });
  it('drafts feedback to support with the words and phone details', async () => {
    jest.mocked(planIntent).mockResolvedValue({ kind: 'draft', draft: { id: 'f' } } as never);
    await runTool('feedback', { text: 'the camera is slow' }, 'tell the makers…', quiet, NOW);
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
  it('a message with a time is a draft that waits until then', async () => {
    const draft = { id: 'm', kind: 'message', status: 'draft' };
    jest.mocked(planIntent).mockResolvedValue({ kind: 'draft', draft } as never);
    const out = await runTool(
      'message',
      { to: 'Sam', text: 'on my way', at: 'today at 6pm' },
      'text Sam at six saying on my way',
      quiet,
      NOW,
    );
    expect(planIntent).toHaveBeenCalledWith(
      { type: 'message', name: 'Sam', text: 'on my way', app: 'auto' },
      NOW,
    );
    expect(out).toEqual({
      kind: 'plan',
      plan: {
        kind: 'draft',
        draft: { ...draft, scheduledAt: new Date(2026, 10, 25, 18, 0).getTime() },
      },
    });
  });
  it('a message time already past is asked again, nothing drafted', async () => {
    const out = await runTool(
      'message',
      { to: 'Sam', text: 'hi', at: 'today at 9am' },
      'q',
      quiet,
      NOW,
    );
    expect(out?.kind).toBe('reply');
    expect(planIntent).not.toHaveBeenCalled();
  });
  it('the open draft: send or cancel', async () => {
    jest.mocked(planIntent).mockResolvedValue({ kind: 'reply', text: 'ok' } as never);
    await runTool('draft', { do: 'send' }, 'yes send it', quiet, NOW);
    await runTool('draft', { do: 'cancel' }, 'forget it', quiet, NOW);
    expect(jest.mocked(planIntent).mock.calls.map((c) => c[0])).toEqual([
      { type: 'sendIt' },
      { type: 'cancelIt' },
    ]);
  });
  it('media "what" asks what is playing', async () => {
    jest.mocked(planIntent).mockResolvedValue({ kind: 'reply', text: 'Playing: x' } as never);
    await runTool('media', { command: 'what' }, 'what song is this', quiet, NOW);
    expect(planIntent).toHaveBeenCalledWith({ type: 'nowPlaying' }, NOW);
  });
  it('the clipboard is added to a normal answer', async () => {
    expect(await runTool('clipboard', {}, 'what did I copy?', quiet, NOW)).toEqual({
      kind: 'answer',
      clipboard: true,
    });
  });
  it('texts are read through the phone', async () => {
    const plan = { kind: 'reply', text: 'Sam: hi' };
    jest.mocked(planTelephony).mockResolvedValue(plan as never);
    const out = await runTool(
      'texts',
      { from: 'Sam', last: true },
      'last text from Sam',
      quiet,
      NOW,
    );
    expect(out).toEqual({ kind: 'plan', plan });
    expect(planTelephony).toHaveBeenCalledWith(
      { type: 'texts', name: 'Sam', last: true, unread: false, range: null },
      NOW,
    );
    jest.mocked(planTelephony).mockResolvedValue(null);
    expect((await runTool('texts', {}, 'any texts?', quiet, NOW))?.kind).toBe('reply');
  });
});

describe('filling one tool', () => {
  it('asks for that tool alone and checks the call', async () => {
    const ask = replies('{"minutes":5}');
    const out = await fillTool('give me five minutes on the clock', 'timer', { ask, now: NOW });
    expect(out).toMatchObject({ tool: 'timer', args: { minutes: 5 }, offered: ['timer'] });
    expect(ask.mock.calls[0][0]).toContain('timer');
  });
  it('lets the model say the tool does not fit, and reports a bad call', async () => {
    expect((await fillTool('ping Sam', 'message', { ask: replies('{"none":true}') }))?.tool).toBe(
      'none',
    );
    const bad = await fillTool('ping Sam', 'message', {
      ask: replies('{"to":"Sam"}', '{"to":"Sam"}'),
    });
    expect(bad?.error).toBeTruthy();
    expect((await fillTool('ping Sam', 'message', { ask: replies('hmm', 'hmm') }))?.error).toBe(
      'unparsed',
    );
  });
  it('asks once more with the reason when the schema refuses the call', async () => {
    const ask = replies('{"torch":true}', '{"setting":"torch","on":true}');
    const out = await fillTool('torch on', 'phone_setting', { ask, now: NOW });
    expect(out).toMatchObject({ tool: 'phone_setting', args: { setting: 'torch', on: true } });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][0]).toContain('was refused: setting missing');
  });
  it('does not ask again about a message to the user themselves', async () => {
    const ask = replies('{"to":"me","text":"a fun fact"}');
    expect((await fillTool('text me a fun fact', 'message', { ask }))?.error).toBe(
      'to is the user',
    );
    expect(ask).toHaveBeenCalledTimes(1);
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

describe('location phrases', () => {
  it('turns the model choice into a phrase the rules know', () => {
    expect(locationPhrase('where_now', '', '')).toMatch(/where am i/i);
    expect(locationPhrase('parked', '', '')).toMatch(/park/i);
  });
});

import {
  type Routine,
  briefingRoutine,
  confirmation,
  inMinutes,
  inReplyVoice,
  describeWhen,
  dueRoutines,
  isBriefing,
  isReadOut,
  messageMatches,
  newRoutine,
  nextTime,
  parseRoutine,
  routineQuestion,
  triggerAllowed,
  upcoming,
  batteryAllows,
} from '@/engine/routines-logic';

const NOW = new Date(2026, 10, 25, 12, 0, 0); // Wed 25 Nov 2026 12:00

function ok(text: string) {
  const r = parseRoutine(text, NOW);
  if (!r || !r.ok) throw new Error(`not parsed: ${text} → ${JSON.stringify(r)}`);
  return r;
}

describe('parseRoutine: scheduled', () => {
  it('every day at 6pm', () => {
    const r = ok('every day at 6pm give me a recap of my day');
    expect(r.when).toEqual({ type: 'daily', hour: 18, minute: 0 });
    expect(r.action).toBe('give me a recap of my day');
  });
  it('every Monday at 8', () => {
    const r = ok('Every Monday at 8 summarise last week and my calendar');
    expect(r.when).toEqual({ type: 'weekly', days: [1], hour: 8, minute: 0 });
    expect(r.action).toBe('summarise last week and my calendar');
  });
  it('every weekday morning', () => {
    const r = ok('every weekday morning brief me');
    expect(r.when).toEqual({ type: 'weekly', days: [1, 2, 3, 4, 5], hour: 8, minute: 0 });
    expect(r.action).toBe('brief me');
  });
  it('every evening, with comma', () => {
    const r = ok('every evening, tell me what I said I would do tomorrow');
    expect(r.when).toEqual({ type: 'daily', hour: 18, minute: 0 });
    expect(r.action).toBe('tell me what I said I would do tomorrow');
  });
  it('several weekdays and a time', () => {
    const r = ok('every Tuesday and Thursday at 7:30pm list my open to-dos');
    expect(r.when).toEqual({ type: 'weekly', days: [2, 4], hour: 19, minute: 30 });
  });
  it('one-off at 3pm tomorrow', () => {
    const r = ok('at 3pm tomorrow check my to-dos');
    expect(r.when.type).toBe('once');
    const at = new Date((r.when as { at: number }).at);
    expect([at.getDate(), at.getHours()]).toEqual([26, 15]);
    expect(r.action).toBe('check my to-dos');
  });
  it('one-off tomorrow at 9', () => {
    const r = ok('tomorrow at 9am summarise this morning');
    expect(new Date((r.when as { at: number }).at).getHours()).toBe(9);
  });
  it('interval and minimum', () => {
    expect(ok('every 2 hours tell me my step count').when).toEqual({
      type: 'interval',
      everyMin: 120,
    });
    const r = parseRoutine('every 5 minutes say hi', NOW);
    expect(r && !r.ok).toBe(true);
  });
  it('leaves reminders and normal questions alone', () => {
    expect(parseRoutine('remind me every Monday at 9 to call mum', NOW)).toBeNull();
    expect(parseRoutine('what did I do every day last week?', NOW)).toBeNull();
    expect(parseRoutine('when is my next meeting?', NOW)).toBeNull();
  });
});

describe('parseRoutine: triggers', () => {
  it('whenever Sam messages me, read it out', () => {
    const r = ok('whenever Sam messages me, read it out');
    expect(r.when).toEqual({ type: 'message', who: 'Sam', app: null });
    expect(r.action).toBe('read it out');
  });
  it('message on an app from anyone', () => {
    expect(ok('when I get a WhatsApp message, read it out').when).toEqual({
      type: 'message',
      who: null,
      app: 'whatsapp',
    });
    expect(ok('whenever I get a message from Jo Smith tell me').when).toEqual({
      type: 'message',
      who: 'Jo Smith',
      app: null,
    });
  });
  it('device and phone triggers', () => {
    expect(ok('when I connect my headphones, tell me my next meeting').when.type).toBe(
      'headphones',
    );
    expect(ok('when I get in the car tell me my to-dos').when.type).toBe('car');
    expect(ok('when I start charging, back up my day').when.type).toBe('charging');
    expect(ok('when I first unlock my phone, brief me').when.type).toBe('unlock');
  });
  it('places', () => {
    expect(ok('when I get home remind me what I said I would do').when).toEqual({
      type: 'place',
      place: 'home',
      edge: 'enter',
    });
    expect(ok('when I leave work, give me a recap of my day').when).toEqual({
      type: 'place',
      place: 'work',
      edge: 'leave',
    });
  });
  it('before each meeting', () => {
    expect(ok('10 minutes before each meeting tell me what it is').when).toEqual({
      type: 'event',
      minutesBefore: 10,
    });
  });
  it('trigger without an action', () => {
    const r = parseRoutine('whenever Sam messages me', NOW);
    expect(r && !r.ok).toBe(true);
  });
});

function routine(over: Partial<Routine>): Routine {
  return {
    id: 'x',
    said: '',
    action: 'a',
    when: { type: 'daily', hour: 18, minute: 0 },
    paused: false,
    createdAt: new Date(2026, 10, 20, 9).getTime(),
    lastRunAt: null,
    ...over,
  };
}

describe('times', () => {
  it('next daily and weekly time', () => {
    const r = routine({});
    expect(new Date(nextTime(r, NOW.getTime())!).getHours()).toBe(18);
    const w = routine({ when: { type: 'weekly', days: [1], hour: 8, minute: 0 } });
    const n = new Date(nextTime(w, NOW.getTime())!);
    expect([n.getDay(), n.getDate(), n.getHours()]).toEqual([1, 30, 8]);
  });
  it('due, late and skipped', () => {
    const yesterday = new Date(2026, 10, 24, 18).getTime();
    // Ran on the 23rd; missed the 24th at 18:00 (18 h ago) → skipped.
    const r = routine({ lastRunAt: new Date(2026, 10, 23, 18).getTime() });
    const d = dueRoutines([r], NOW.getTime());
    expect(d.run).toEqual([]);
    expect(d.skip[0].dueAt).toBe(yesterday);
    // 18:20: due and late.
    const t = new Date(2026, 10, 25, 18, 20).getTime();
    const e = dueRoutines([routine({ lastRunAt: yesterday })], t);
    expect(e.run[0]).toMatchObject({ late: true, dueAt: new Date(2026, 10, 25, 18).getTime() });
    // 18:01: on time.
    expect(dueRoutines([routine({ lastRunAt: yesterday })], t - 19 * 60_000).run[0].late).toBe(
      false,
    );
    // Paused: nothing.
    expect(dueRoutines([routine({ lastRunAt: yesterday, paused: true })], t).run).toEqual([]);
  });
  it('one-off runs once', () => {
    const at = NOW.getTime() + 3_600_000;
    const r = routine({ when: { type: 'once', at } });
    expect(upcoming([r], NOW.getTime())).toEqual([{ id: 'x', at }]);
    expect(dueRoutines([r], at + 1000).run).toHaveLength(1);
    expect(dueRoutines([{ ...r, lastRunAt: at }], at + 1000).run).toHaveLength(0);
  });
  it('interval', () => {
    const r = routine({ when: { type: 'interval', everyMin: 60 }, anchor: NOW.getTime() });
    expect(nextTime(r, NOW.getTime())).toBe(NOW.getTime() + 3_600_000);
  });
});

describe('triggers and limits', () => {
  it('trigger gaps', () => {
    const r = routine({ when: { type: 'charging' }, lastRunAt: NOW.getTime() - 60_000 });
    expect(triggerAllowed(r, NOW.getTime())).toBe(false);
    expect(triggerAllowed(r, NOW.getTime() + 15 * 60_000)).toBe(true);
    const u = routine({ when: { type: 'unlock' }, lastRunAt: new Date(2026, 10, 25, 7).getTime() });
    expect(triggerAllowed(u, NOW.getTime())).toBe(false);
    expect(triggerAllowed(u, new Date(2026, 10, 26, 7).getTime())).toBe(true);
  });
  it('message matching', () => {
    const t = { type: 'message' as const, who: 'Sam', app: 'whatsapp' };
    expect(messageMatches(t, { title: 'Sam Taylor', app: 'WhatsApp', pkg: 'com.whatsapp' })).toBe(
      true,
    );
    expect(messageMatches(t, { title: 'Samantha', app: 'WhatsApp', pkg: 'com.whatsapp' })).toBe(
      false,
    );
    expect(
      messageMatches(t, {
        title: 'Sam',
        app: 'Messages',
        pkg: 'com.google.android.apps.messaging',
      }),
    ).toBe(false);
    expect(
      messageMatches(
        { type: 'message', who: null, app: 'sms' },
        { title: 'Jo', app: 'Messages', pkg: 'x' },
      ),
    ).toBe(true);
  });
  it('limit and duplicates', () => {
    const list = Array.from({ length: 20 }, (_, i) => routine({ id: String(i), action: `a${i}` }));
    expect(newRoutine(list, 's', { type: 'car' }, 'b', 1).ok).toBe(false);
    expect(newRoutine([routine({})], 's', { type: 'daily', hour: 18, minute: 0 }, 'A', 1).ok).toBe(
      false,
    );
    expect(newRoutine([], 's', { type: 'car' }, 'b', 1).ok).toBe(true);
  });
  it('battery', () => {
    expect(batteryAllows({ batteryLevel: 0.1, charging: false, lowPowerMode: false })).toBe(false);
    expect(batteryAllows({ batteryLevel: 0.1, charging: true, lowPowerMode: true })).toBe(true);
    expect(batteryAllows({ batteryLevel: 0.5, charging: false, lowPowerMode: true })).toBe(false);
  });
});

describe('words', () => {
  it('describes', () => {
    expect(describeWhen({ type: 'weekly', days: [1, 2, 3, 4, 5], hour: 8, minute: 0 })).toBe(
      'Weekdays at 08:00',
    );
    expect(describeWhen({ type: 'message', who: 'Sam', app: null })).toBe('When Sam messages you');
  });
  it('quick actions', () => {
    expect(isBriefing('brief me')).toBe(true);
    expect(isBriefing('give me my briefing')).toBe(true);
    expect(isBriefing('brief me on the news')).toBe(false);
    expect(isReadOut('read it out')).toBe(true);
    expect(isReadOut('read it out and reply')).toBe(false);
  });
  it('question with context', () => {
    const q = routineQuestion(
      'tell me if it is urgent',
      { type: 'message', who: 'Sam', app: 'WhatsApp', text: 'call me' },
      NOW,
    );
    expect(q).toBe(
      'A message from Sam on WhatsApp just arrived: "call me". tell me if it is urgent',
    );
  });
  it('briefing migration', () => {
    expect(briefingRoutine(7)).toMatchObject({
      when: { type: 'daily', hour: 7, minute: 0 },
      action: 'brief me',
    });
  });
});

describe('one-off in N minutes (phone: "in one minute, tell me a fun fact" went to messaging)', () => {
  const now = new Date(2026, 10, 26, 23, 58, 0);
  test('leading and trailing relative times become one-off routines', () => {
    const a = parseRoutine('in one minute, tell me a fun fact', now);
    expect(a).toEqual({
      ok: true,
      when: { type: 'once', at: now.getTime() + 60_000 },
      action: 'tell me a fun fact',
    });
    const b = parseRoutine('check the weather in half an hour', now);
    expect(b).toMatchObject({ ok: true, when: { type: 'once', at: now.getTime() + 30 * 60_000 } });
    expect(parseRoutine('in 2 hours remind me to stretch', now)).toBeNull(); // reminders elsewhere
  });
  test('a question with a time in it stays a question', () => {
    expect(parseRoutine('what will the weather be in 2 hours', now)).toBeNull();
    expect(parseRoutine('in 5 minutes what is the time', now)).toBeNull();
  });
  test('minutes in a phrase', () => {
    expect(inMinutes('an hour')).toBe(60);
    expect(inMinutes('forty-five minutes')).toBe(45);
    expect(inMinutes('3 hrs')).toBe(180);
    expect(inMinutes('30 hours')).toBeNull();
  });
});

test("confirmation says the instruction back in Sidekick's voice", () => {
  expect(inReplyVoice('tell me a fun fact')).toBe('tell you a fun fact');
  expect(inReplyVoice('recap my day and remind me what I said')).toBe(
    'recap your day and remind you what you said',
  );
  const c = confirmation(
    { when: { type: 'daily', hour: 23, minute: 59 }, action: 'tell me a fun fact' },
    new Date(2026, 10, 26, 12),
  );
  expect(c).toMatch(/^OK\. Every day at 23:59, I'll tell you a fun fact\./);
});

import {
  asksAboutFollowups,
  digestText,
  type Followup,
  followupContext,
  followupLineText,
  isDuplicate,
  newProposals,
  parseFollowups,
  parseWhen,
} from '@/memory/followup-logic';

// Monday 23 November 2026, 10:00 local time.
const MON = new Date(2026, 10, 23, 10, 0);

function when(phrase: string, ref = MON) {
  const r = parseWhen(phrase, ref);
  if (!r) return null;
  const d = new Date(r.at);
  return {
    date: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
    time: `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`,
    allDay: r.allDay,
  };
}

test('weekdays and relative days', () => {
  expect(when('next Tuesday at 3')).toEqual({ date: '2026-11-24', time: '15:00', allDay: false });
  expect(when('on Monday')).toEqual({ date: '2026-11-30', time: '9:00', allDay: true });
  expect(when('Friday')).toMatchObject({ date: '2026-11-27', allDay: true });
  expect(when('thurs at 10am')).toEqual({ date: '2026-11-26', time: '10:00', allDay: false });
  expect(when('tomorrow')).toEqual({ date: '2026-11-24', time: '9:00', allDay: true });
  expect(when('tomorrow evening at 7')).toMatchObject({ date: '2026-11-24', time: '19:00' });
  expect(when('day after tomorrow at noon')).toMatchObject({ date: '2026-11-25', time: '12:00' });
  expect(when('next week')).toMatchObject({ date: '2026-11-30', allDay: true });
  expect(when('this weekend')).toMatchObject({ date: '2026-11-28', allDay: true });
  expect(when('tonight')).toMatchObject({ date: '2026-11-23', time: '20:00' });
});

test('times of day', () => {
  expect(when('at 5:30pm')).toMatchObject({ date: '2026-11-23', time: '17:30' });
  expect(when('at 15:45')).toMatchObject({ date: '2026-11-23', time: '15:45' });
  expect(when('at 9')).toMatchObject({ date: '2026-11-24', time: '9:00' }); // 9 am already past
  expect(when('at 8 tonight')).toMatchObject({ date: '2026-11-23', time: '20:00' });
  expect(when('half past four')).toMatchObject({ date: '2026-11-23', time: '16:30' });
  expect(when('quarter to 3')).toMatchObject({ time: '14:45' });
  expect(when('12am tomorrow')).toMatchObject({ date: '2026-11-24', time: '0:00' });
  expect(when('this morning')).toMatchObject({ date: '2026-11-23', time: '9:00' });
});

test('offsets and calendar dates', () => {
  expect(when('in 20 minutes')).toMatchObject({ time: '10:20', allDay: false });
  expect(when('in half an hour')).toMatchObject({ time: '10:30' });
  expect(when('in two hours')).toMatchObject({ time: '12:00' });
  expect(when('in 3 days')).toMatchObject({ date: '2026-11-26', allDay: true });
  expect(when('in a week at 2')).toMatchObject({ date: '2026-11-30', time: '14:00' });
  expect(when('24 December')).toMatchObject({ date: '2026-12-24', allDay: true });
  expect(when('December 3rd at 6pm')).toMatchObject({ date: '2026-12-3', time: '18:00' });
  expect(when('the 5th of January')).toMatchObject({ date: '2027-1-5' });
  expect(when('March 2')).toMatchObject({ date: '2027-3-2' }); // past this year → next year
  expect(when('the 25th')).toMatchObject({ date: '2026-11-25' });
  expect(when('the 2nd')).toMatchObject({ date: '2026-12-2' });
  expect(when('2027-02-14')).toMatchObject({ date: '2027-2-14' });
});

test('no time found', () => {
  expect(parseWhen('soon', MON)).toBeNull();
  expect(parseWhen('at work', MON)).toBeNull();
  expect(parseWhen('', MON)).toBeNull();
});

test('parses the model reply against when each line was said', () => {
  const lineAt = [
    { at: MON.getTime(), id: 11 },
    { at: new Date(2026, 10, 20, 18, 0).getTime(), id: 12 }, // Friday
  ];
  const reply = [
    'Here you go:',
    '1 | todo | I need to buy milk | -',
    '2 | Event | Dentist appointment | tomorrow at 3',
    '2. | reminder | Call Sam. | in 2 hours',
    '9 | todo | Out of range | -',
    '1 | task | Buy milk | none',
    'NONE',
  ].join('\n');
  const out = parseFollowups(reply, lineAt);
  expect(out.map((f) => [f.kind, f.title, f.sourceMomentId])).toEqual([
    ['todo', 'Buy milk', 11],
    ['event', 'Dentist appointment', 12],
    ['reminder', 'Call Sam', 12],
  ]);
  // "tomorrow" from Friday evening is Saturday.
  expect(new Date(out[1].dueAt!).getDate()).toBe(21);
  expect(out[0].dueAt).toBeNull();
  expect(new Date(out[2].dueAt!).getHours()).toBe(20);
});

const f = (title: string, dueAt: number | null, extra: Partial<Followup> = {}): Followup => ({
  id: 1,
  kind: 'todo',
  title,
  dueAt,
  allDay: false,
  whenText: '',
  status: 'approved',
  createdAt: 0,
  sourceMomentId: null,
  ...extra,
});

test('duplicates', () => {
  const t = MON.getTime();
  expect(isDuplicate(f('Buy milk', null), f('buy the milk', null))).toBe(true);
  expect(isDuplicate(f('Call Sam', t), f('Call Sam back', t + 3_600_000))).toBe(true);
  expect(isDuplicate(f('Call Sam', t), f('Call Sam', t + 3 * 86_400_000))).toBe(false);
  expect(isDuplicate(f('Call Sam', t), f('Call Alex', t))).toBe(false);
  expect(isDuplicate(f('Dentist', null), f('Dentist appointment', t))).toBe(true);
  const fresh = newProposals(
    [f('Buy milk', null), f('Pay rent', null), f('pay the rent', null)],
    [f('buy milk', null, { status: 'dismissed' })],
  );
  expect(fresh.map((x) => x.title)).toEqual(['Pay rent']);
});

test('digest and agenda', () => {
  const today = new Date(2026, 10, 23, 15, 0).getTime();
  const yesterday = new Date(2026, 10, 22, 9, 0).getTime();
  const items = [
    f('Dentist', today, { kind: 'event' }),
    f('Send invoice', yesterday, { allDay: true }),
    f('Buy milk', null),
    f('Ignored', today, { status: 'suggested' }),
    f('Finished', today, { status: 'done' }),
  ];
  const text = digestText(items, new Date(2026, 10, 23, 8, 0))!;
  expect(text).toMatch(/^Today: Dentist \(/);
  expect(text).toContain('Still open from yesterday: Send invoice.');
  expect(text).toContain('1 open to-do.');
  expect(text).not.toMatch(/Ignored|Finished/);
  expect(digestText([], MON)).toBeNull();

  const ctx = followupContext(items, MON);
  expect(ctx).toContain('Event: Dentist (today');
  expect(ctx.indexOf('Dentist')).toBeLessThan(ctx.indexOf('Buy milk'));
  expect(ctx).not.toContain('Ignored');
});

test('recognises follow-up questions', () => {
  for (const q of [
    'What do I need to do today?',
    'what have I got to do',
    "What's on tomorrow?",
    'Do I have anything this afternoon?',
    'read my reminders',
    'any appointments this week?',
  ])
    expect(asksAboutFollowups(q)).toBe(true);
  for (const q of ['What is this?', 'Who did I meet yesterday?', 'What do you see?'])
    expect(asksAboutFollowups(q)).toBe(false);
});

describe('follow-ups never come from requests to Sidekick', () => {
  it('reads only the answer part of a photo question', () => {
    expect(
      followupLineText('photo', 'Q: Look at the black keyboard\nA: A black keyboard on a desk.'),
    ).toBe('A black keyboard on a desk.');
    expect(followupLineText('photo', 'Q: what is this')).toBeNull();
    expect(followupLineText('photo', 'Poster: concert Friday 8pm')).toBe(
      'Poster: concert Friday 8pm',
    );
    expect(followupLineText('speech', 'I need to call Sam tomorrow')).toBe(
      'I need to call Sam tomorrow',
    );
  });
  it('drops commands to an assistant and titles not from the line', () => {
    const lines = [
      { at: 0, id: 1, text: 'Calculate 2 plus 2' },
      { at: 0, id: 2, text: "I'll send the invoice to Sam on Friday" },
    ];
    const reply = [
      '1 | todo | Calculate 2 plus 2 | -',
      '2 | todo | Send the invoice to Sam | Friday',
      '2 | todo | Book a holiday | -',
    ].join('\n');
    expect(parseFollowups(reply, lines).map((x) => x.title)).toEqual(['Send the invoice to Sam']);
  });
});

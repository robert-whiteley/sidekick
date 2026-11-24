import { parseReminderRequest } from '../src/memory/followup-logic';

// Monday 24 Nov 2025, 14:00 local.
const now = new Date(2025, 10, 24, 14, 0);

describe('parseReminderRequest', () => {
  it('reads title and time with the time words removed', () => {
    const r = parseReminderRequest('Remind me to call the dentist tomorrow at nine.', now)!;
    expect(r.kind).toBe('reminder');
    expect(r.title).toBe('Call the dentist');
    expect(new Date(r.dueAt!)).toEqual(new Date(2025, 10, 25, 9, 0));
    expect(r.allDay).toBe(false);
    expect(r.whenText).toBe('tomorrow at nine');
  });

  it('handles the time before the task', () => {
    const r = parseReminderRequest('remind me in 20 minutes to check the oven', now)!;
    expect(r.title).toBe('Check the oven');
    expect(r.dueAt).toBe(now.getTime() + 20 * 60_000);
  });

  it('handles polite forms and weekdays', () => {
    const r = parseReminderRequest('Can you remind me about the bins on Thursday?', now)!;
    expect(r.title).toBe('The bins');
    expect(r.allDay).toBe(true);
    expect(new Date(r.dueAt!).getDate()).toBe(27);
  });

  it('makes an undated to-do when no time is said', () => {
    const r = parseReminderRequest('remind me to buy milk', now)!;
    expect(r).toEqual({
      kind: 'todo',
      title: 'Buy milk',
      dueAt: null,
      allDay: false,
      whenText: '',
    });
  });

  it('ignores other questions', () => {
    expect(parseReminderRequest('what did you remind me about?', now)).toBeNull();
    expect(parseReminderRequest('remind me', now)).toBeNull();
    expect(parseReminderRequest('remind me tomorrow', now)).toBeNull();
    expect(parseReminderRequest('Remind me what Sam said yesterday', now)).toBeNull();
    expect(parseReminderRequest('remind me where I parked', now)).toBeNull();
    expect(parseReminderRequest('remind me who Sam is', now)).toBeNull();
    expect(parseReminderRequest('remind me when the meeting is', now)).toBeNull();
  });
});

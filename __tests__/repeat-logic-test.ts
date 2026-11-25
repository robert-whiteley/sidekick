import { parseReminderRequest } from '@/memory/followup-logic';
import {
  isRepeat,
  nextOccurrence,
  parseRepeat,
  repeatLabel,
  repeatTriggers,
} from '@/memory/repeat-logic';

const wed = new Date(2026, 10, 25, 14, 0); // Wednesday 25 Nov 2026

test('repeat words', () => {
  expect(parseRepeat('every day at 8')?.repeat).toBe('daily');
  expect(parseRepeat('daily')?.repeat).toBe('daily');
  expect(parseRepeat('every weekday at 7')?.repeat).toBe('weekdays');
  expect(parseRepeat('every Monday at 9')?.repeat).toBe('weekly:1');
  expect(parseRepeat('on Sundays')?.repeat).toBe('weekly:0');
  expect(parseRepeat('next Monday at 9')).toBeNull();
  expect(parseRepeat('tomorrow')).toBeNull();
  expect(isRepeat('weekly:6')).toBe(true);
  expect(isRepeat('weekly:7')).toBe(false);
  expect(isRepeat(null)).toBe(false);
});

test('next occurrence keeps the time of day', () => {
  const nine = new Date(2026, 10, 25, 9, 0).getTime();
  expect(nextOccurrence('daily', nine, wed.getTime())).toBe(new Date(2026, 10, 26, 9).getTime());
  expect(nextOccurrence('weekly:1', nine, wed.getTime())).toBe(new Date(2026, 10, 30, 9).getTime());
  // Friday after 9 → Monday
  expect(nextOccurrence('weekdays', nine, new Date(2026, 10, 27, 10).getTime())).toBe(
    new Date(2026, 10, 30, 9).getTime(),
  );
  expect(repeatLabel('weekly:1')).toBe('every Monday');
  expect(repeatLabel('weekdays')).toBe('every weekday');
});

test('notification triggers (weekday 1 = Sunday)', () => {
  const t = new Date(2026, 10, 30, 9, 30).getTime();
  expect(repeatTriggers('daily', t)).toEqual([{ type: 'daily', hour: 9, minute: 30 }]);
  expect(repeatTriggers('weekly:1', t)).toEqual([
    { type: 'weekly', weekday: 2, hour: 9, minute: 30 },
  ]);
  expect(repeatTriggers('weekdays', t)).toHaveLength(5);
});

test('"remind me every Monday at 9 to put the bins out"', () => {
  const r = parseReminderRequest('Remind me every Monday at 9 to put the bins out', wed)!;
  expect(r).toMatchObject({ kind: 'reminder', title: 'Put the bins out', repeat: 'weekly:1' });
  expect(r.dueAt).toBe(new Date(2026, 10, 30, 9).getTime());
  const d = parseReminderRequest('remind me to take my pills every day at 8pm', wed)!;
  expect(d).toMatchObject({ repeat: 'daily', title: 'Take my pills' });
  expect(d.dueAt).toBe(new Date(2026, 10, 25, 20).getTime());
  const noTime = parseReminderRequest('remind me every weekday to stretch', wed)!;
  expect(noTime.repeat).toBe('weekdays');
  expect(new Date(noTime.dueAt!).getHours()).toBe(9);
  // One-offs are unchanged.
  expect(parseReminderRequest('remind me tomorrow at 9 to call Sam', wed)?.repeat).toBeUndefined();
});

test('"on Thursday" is a one-off; "on Thursdays" repeats', () => {
  expect(parseRepeat('about the bins on Thursday')).toBeNull();
  expect(parseRepeat('about the bins on Thursdays')?.repeat).toBe('weekly:4');
});

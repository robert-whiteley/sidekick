import { sendsAtText, splitSchedule } from '@/integrations/schedule-logic';

const now = new Date(2026, 10, 25, 14, 0);
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();

test('a send time before the verb, after the recipient, or after "send it"', () => {
  expect(splitSchedule("At 6pm text Sam I'm on my way", now)).toEqual({
    rest: "text Sam I'm on my way",
    at: at(25, 18),
    whenText: 'At 6pm',
  });
  expect(splitSchedule('text Sam at 6pm saying dinner is ready', now)?.rest).toBe(
    'text Sam saying dinner is ready',
  );
  expect(splitSchedule('email Jo tomorrow morning about the report', now)).toMatchObject({
    rest: 'email Jo about the report',
    at: at(26, 9),
  });
  expect(splitSchedule("text Sam I'm home, send it at 9pm", now)).toMatchObject({
    rest: "text Sam I'm home",
    at: at(25, 21),
  });
  expect(splitSchedule('Tomorrow at 8, text Jo happy birthday', now)?.at).toBe(at(26, 8));
});

test('a time inside the message is part of the message', () => {
  expect(splitSchedule("text Sam I'll see you tomorrow", now)).toBeNull();
  expect(splitSchedule('text Sam the film starts at 8', now)).toBeNull();
  expect(splitSchedule('remind me at 6pm to call Sam', now)).toBeNull();
  expect(splitSchedule('what is on at 6pm', now)).toBeNull();
});

test('a time already past is not a schedule', () => {
  expect(splitSchedule('text Sam at 9am saying hi', new Date(2026, 10, 25, 23, 0))?.at).toBe(
    at(26, 9),
  );
  expect(splitSchedule('today at noon text Sam hi', now)).toBeNull();
});

test('card label', () => {
  expect(sendsAtText(at(25, 18), now)).toMatch(/^Sends at 18:00$|^Sends at 06:00 PM$/i);
  expect(sendsAtText(at(26, 8), now)).toMatch(/^Sends tomorrow at /);
  expect(sendsAtText(at(28, 8), now)).toMatch(/^Sends .*28.* at /);
});

import { parseTimeRange } from '@/memory/time-range';

// Wednesday 25 November 2026, 15:00 local time.
const NOW = new Date(2026, 10, 25, 15, 0);
const t = NOW.getTime();
const H = 3_600_000;
const r = (q: string, opts = {}) => parseTimeRange(q, NOW, opts);
const d = (day: number, h = 0, m = 0) => new Date(2026, 10, day, h, m).getTime();

test('recent spans: last N hours, past few days, half an hour', () => {
  expect(r('recap the last 2 hours')).toEqual({
    from: t - 2 * H,
    to: t,
    label: 'in the last 2 hours',
  });
  expect(r('what did we talk about in the past hour')!.from).toBe(t - H);
  expect(r('the last few hours')!.from).toBe(t - 3 * H);
  expect(r('last half an hour')!.from).toBe(t - H / 2);
  expect(r('over the past 3 days')!.from).toBe(t - 3 * 86_400_000);
  expect(r('last twenty minutes')!.from).toBe(t - 20 * 60_000);
});

test('ago: a window around then; days ago is that day', () => {
  const five = r('what did I see 5 minutes ago?')!;
  expect([five.from, five.to]).toEqual([t - 7.5 * 60_000, t - 2.5 * 60_000]);
  expect(r('3 days ago')).toMatchObject({ from: d(22), to: d(23) });
  expect(r('a few days ago')).toMatchObject({ from: d(21), to: d(24) });
});

test('parts of days', () => {
  expect(r('this morning')).toMatchObject({ from: d(25), to: d(25, 12) });
  expect(r('summarise yesterday afternoon')).toMatchObject({ from: d(24, 12), to: d(24, 18) });
  expect(r('last night')).toMatchObject({ from: d(24, 17), to: d(25, 5) });
  expect(r('today so far')).toMatchObject({ from: d(25), to: t });
  expect(r('what did I see earlier')).toMatchObject({ from: d(25), to: t });
  expect(r('yesterday')).toMatchObject({ from: d(24), to: d(25) });
  expect(r('the day before yesterday')).toMatchObject({ from: d(23), to: d(24) });
});

test('weekdays and weekends', () => {
  expect(r('what did we talk about last Tuesday')).toMatchObject({ from: d(24), to: d(25) });
  expect(r('on Monday morning')).toMatchObject({ from: d(23), to: d(23, 12) });
  expect(r('on Wednesday')).toMatchObject({ from: d(25) }); // today
  expect(r('last Wednesday')).toMatchObject({ from: d(18) });
  expect(r('Friday')).toMatchObject({ from: d(20), to: d(21) });
  expect(r('over the weekend')).toMatchObject({ from: d(21), to: d(23) });
  expect(r('what are you doing next Friday')).toBeNull();
});

test('clock times: between, since, at', () => {
  expect(r('between 2 and 4')).toMatchObject({ from: d(25, 14), to: d(25, 16) });
  expect(r('between 2 and 4 yesterday')).toMatchObject({ from: d(24, 14), to: d(24, 16) });
  expect(r('from 9am to 11')).toMatchObject({ from: d(25, 9), to: d(25, 11) });
  expect(r('between 4 and 6')).toMatchObject({ from: d(24, 16), to: d(24, 18) }); // still ahead today
  expect(r('since 9')).toEqual({ from: d(25, 9), to: t, label: 'since 09:00' });
  expect(r('since 14:30')).toMatchObject({ from: d(25, 14, 30) });
  expect(r('since 2')).toMatchObject({ from: d(25, 14) });
  expect(r('since I got up')).toMatchObject({ from: d(25, 6) });
  expect(r('since I woke up', { wakeAt: d(25, 7, 12) })).toMatchObject({ from: d(25, 7, 12) });
  expect(r('since Monday')).toMatchObject({ from: d(23), to: t });
  expect(r('what did I see at 3pm yesterday')).toMatchObject({
    from: d(24, 14, 30),
    to: d(24, 15, 30),
  });
  expect(r('around 11:00')).toMatchObject({ from: d(25, 10, 30), to: d(25, 11, 30) });
});

test('dates, weeks, months', () => {
  expect(r('on 5 March')).toMatchObject({ from: new Date(2026, 2, 5).getTime() });
  expect(r('December 24th')).toMatchObject({ from: new Date(2025, 11, 24).getTime() });
  expect(r('on the 3rd')).toMatchObject({ from: d(3) });
  expect(r('last week')).toMatchObject({ from: d(16), to: d(23) });
  expect(r('this week')).toMatchObject({ from: d(23) });
  expect(r('last month')).toMatchObject({ from: new Date(2026, 9, 1).getTime(), to: d(1) });
  expect(r('what did I do in March')).toMatchObject({
    from: new Date(2026, 2, 1).getTime(),
    to: new Date(2026, 3, 1).getTime(),
  });
  expect(r('in December')!.from).toBe(new Date(2025, 11, 1).getTime());
});

test('not time ranges', () => {
  for (const q of [
    'what is the capital of France',
    'this may be wrong',
    'what did I see in the sun',
    'remind me to march on',
    'call Sam at 5 Main Street',
    'how many minutes in an hour',
  ])
    expect(r(q)).toBeNull();
});

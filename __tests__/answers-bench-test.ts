/**
 * The answers + routing bench (bench/answers/cases.ts): the cases themselves and the scoring
 * helpers. Routing is the model's (decide.ts, tools.ts), so it is scored only on the phone.
 */
import { CASES } from '../bench/answers/cases';
import { argsMatch, canonFromCall, scoreAnswer, scoreRoute } from '@/engine/answers-bench-logic';

// Thursday 26 November 2026, 14:30 local.
const NOW = new Date(2026, 10, 26, 14, 30);

test('case ids are unique and every case has a route', () => {
  const ids = CASES.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const c of CASES) expect(c.route).toBeTruthy();
  expect(CASES.length).toBeGreaterThanOrEqual(120);
});

test('scoring helpers', () => {
  expect(argsMatch({ seconds: 600 }, { seconds: 600 })).toBe(true);
  expect(argsMatch({ seconds: 600 }, { seconds: 300 })).toBe(false);
  expect(argsMatch({ to: 'sam' }, { to: 'Sam' })).toBe(true);
  expect(argsMatch({ timed: true }, { timed: false })).toBe(false);
  expect(canonFromCall('timer', { minutes: 2.5 }).args.seconds).toBe(150);
  expect(canonFromCall('alarm', { time: '06:30' }).args).toEqual({ hour: 6, minute: 30 });
  expect(canonFromCall('routine', { when: 'in 1 minute', instruction: 'x' }).args.repeat).toBe(
    false,
  );
  expect(canonFromCall('camera_setting', { frames: 'fewer' }).args.frames).toBe('fewer');
  expect(scoreRoute({ id: 'x', route: 'timer' }, { tool: 'alarm', args: {} })).toBe('fail');
  expect(scoreRoute({ id: 'x', route: 'none' }, { tool: 'none', args: {} })).not.toBe('fail');
  expect(
    scoreAnswer({ id: 'x', route: 'none', answer: { any: ['{weekday}'] } }, 'Thursday', NOW),
  ).toBe(true);
});

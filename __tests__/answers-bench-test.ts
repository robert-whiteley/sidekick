/**
 * The answers + routing bench, offline part: every case in bench/answers/cases.ts through the
 * rules (route-trace-logic.ts) and the router's offered tools, scored. Set BENCH_OUT=<file> to
 * write the per-case results as JSON (bench/answers/README.md).
 */
import { writeFileSync } from 'fs';
import { CASES } from '../bench/answers/cases';
import {
  argsMatch,
  canonFromCall,
  canonFromTrace,
  scoreAnswer,
  scoreRoute,
  summarise,
  type BenchLine,
} from '@/engine/answers-bench-logic';
import { traceRules } from '@/engine/route-trace-logic';
import { decideLookup } from '@/web/lookup-logic';

// Thursday 26 November 2026, 14:30 local.
const NOW = new Date(2026, 10, 26, 14, 30);

function run(): BenchLine[] {
  return CASES.map((c) => {
    const trace = traceRules(c.q, NOW);
    const got = canonFromTrace(trace);
    const line: BenchLine = {
      id: c.id,
      cat: c.cat,
      q: c.q,
      route: scoreRoute(c, got),
      got: got.tool === 'router' ? `router[${(got.offered ?? []).join(',')}]` : got.tool,
      args: got.args,
    };
    // Rule answers (sums, dates) are checked here; model answers only on the phone.
    if (got.tool === 'quick_answer') line.answerOk = scoreAnswer(c, String(got.args.text), NOW);
    return line;
  });
}

test('case ids are unique and every case has a route', () => {
  const ids = CASES.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const c of CASES) expect(c.route).toBeTruthy();
  expect(CASES.length).toBeGreaterThanOrEqual(120);
});

test('offline routing scores (report)', () => {
  const lines = run();
  const sum = summarise(lines);
  if (process.env.BENCH_OUT)
    writeFileSync(process.env.BENCH_OUT, JSON.stringify({ summary: sum, lines }, null, 2));
  expect(sum.all.n).toBe(CASES.length);
});

test('lookup rules match the cases', () => {
  for (const c of CASES.filter((x) => x.lookup)) {
    expect([c.id, decideLookup(c.q, { enabled: true, photo: false, knownNames: [] })]).toEqual([
      c.id,
      c.lookup,
    ]);
    expect(decideLookup(c.q, { enabled: false, photo: false, knownNames: [] })).toBe('none');
  }
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
  expect(scoreRoute({ id: 'x', route: 'none' }, { tool: 'router', args: {}, offered: [] })).toBe(
    'router_risk',
  );
  expect(
    scoreRoute({ id: 'x', route: 'timer' }, { tool: 'router', args: {}, offered: ['alarm'] }),
  ).toBe('fail');
  expect(
    scoreAnswer({ id: 'x', route: 'none', answer: { any: ['{weekday}'] } }, 'Thursday', NOW),
  ).toBe(true);
});

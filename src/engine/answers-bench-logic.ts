/**
 * Scoring for the answers + routing bench (cases in bench/answers/cases.ts): what the model
 * chose, as one canonical tool with canonical arguments, checked against the case;
 * and the answer text checked by its rules. Pure; used by __tests__/answers-bench-test.ts and the
 * dev bench screen (src/app/bench.tsx).
 */
import { parseFrames } from './camera-settings-logic';

export type Canon = { tool: string; args: Record<string, unknown>; offered?: string[] };

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Bench scoring only: does the model's routine time say it repeats. */
const REPEATS = /\b(every|each|whenever|daily|weekly|hourly|any ?time|each time)\b/i;

/** The model router's validated call as a canonical tool call. */
export function canonFromCall(tool: string, a: Record<string, unknown>): Canon {
  switch (tool) {
    case 'timer':
      return {
        tool,
        args: { seconds: typeof a.minutes === 'number' ? Math.round(a.minutes * 60) : undefined },
      };
    case 'alarm': {
      const m = /^(\d{1,2})[:.](\d{2})$/.exec(str(a.time));
      return { tool, args: m ? { hour: +m[1], minute: +m[2] } : {} };
    }
    case 'reminder':
      return { tool, args: { what: a.what, timed: !!str(a.when) } };
    case 'routine':
      return { tool, args: { repeat: REPEATS.test(str(a.when)), action: a.instruction } };
    case 'camera_setting':
      return {
        tool,
        args: { ...parseFrames(a.frames), lens: a.lens, detail: a.detail },
      };
    case 'speech_speed':
      return {
        tool,
        args: typeof a.percent === 'number' ? { rate: a.percent / 100 } : { change: a.change },
      };
    case 'message':
      return { tool, args: { to: a.to, text: a.text } };
    case 'email':
      return { tool, args: { to: a.to, text: a.body } };
    case 'watch':
      return { tool, args: { what: a.thing } };
    case 'memory_search':
    case 'recap':
      return { tool, args: {} };
    default:
      return { tool, args: { ...a } };
  }
}

export type BenchCaseLike = {
  id: string;
  route: string;
  args?: Record<string, string | number | boolean>;
  answer?: { all?: string[]; any?: string[]; not?: string[] };
};

/** The tools a case accepts ('timer|reminder'). */
export const allowed = (c: BenchCaseLike) => c.route.split('|');

/** Every expected argument is there and right. Detail fields: 'high' also accepts 'higher'. */
export function argsMatch(want: BenchCaseLike['args'], got: Record<string, unknown>): boolean {
  for (const [key, w] of Object.entries(want ?? {})) {
    const g = got[key];
    if (typeof w === 'number') {
      if (typeof g !== 'number' || Math.abs(g - w) > 0.01) return false;
    } else if (typeof w === 'boolean') {
      if (Boolean(g) !== w) return false;
    } else if (!new RegExp(w, 'i').test(g === undefined || g === null ? '' : String(g))) {
      return false;
    }
  }
  return true;
}

export type RouteScore =
  /** Right tool (and arguments). */
  | 'pass'
  /** Right tool, wrong or missing arguments. */
  | 'args'
  /** Wrong tool, or a tool where none was wanted. */
  | 'fail'
  /** Offline only: the model router decides; the right tool is among those offered. */
  | 'model'
  /** Offline only: the router would run for a plain question (slow, and a wrong-tool risk). */
  | 'router_risk';

export function scoreRoute(c: BenchCaseLike, got: Canon): RouteScore {
  const ok = allowed(c);
  if (got.tool === 'router') {
    if (ok.includes('none') && ok.length === 1) return 'router_risk';
    const offered = got.offered ?? [];
    // A plain answer is always open to the router ({"tool":"none"}).
    return ok.some((t) => t === 'none' || offered.includes(t)) ? 'model' : 'fail';
  }
  if (!ok.includes(got.tool)) return 'fail';
  // Arguments are checked for the case's first-choice tool only.
  if (got.tool === ok[0] && !argsMatch(c.args, got.args)) return 'args';
  return 'pass';
}

// --- Answers ---

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Values for {placeholders} in answer rules, from the time of the run. */
export function answerVars(now: Date): Record<string, string> {
  const today = midnight(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  let xmas = new Date(now.getFullYear(), 11, 25);
  if (xmas < today) xmas = new Date(now.getFullYear() + 1, 11, 25);
  const days = Math.round((xmas.getTime() - today.getTime()) / 86_400_000);
  return {
    weekday: WEEKDAYS[now.getDay()],
    tomorrowWeekday: WEEKDAYS[tomorrow.getDay()],
    date: String(now.getDate()),
    month: MONTHS[now.getMonth()],
    year: String(now.getFullYear()),
    daysToChristmas: String(days),
    christmasWeekday: WEEKDAYS[new Date(now.getFullYear(), 11, 25).getDay()],
  };
}

const fill = (re: string, vars: Record<string, string>) =>
  re.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

/** null when the case has no answer rules. */
export function scoreAnswer(c: BenchCaseLike, text: string, now: Date): boolean | null {
  const a = c.answer;
  if (!a) return null;
  const vars = answerVars(now);
  const t = text.replace(/\s+/g, ' ');
  const test = (re: string) => new RegExp(fill(re, vars), 'i').test(t);
  if (a.all && !a.all.every(test)) return false;
  if (a.any && !a.any.some(test)) return false;
  if (a.not && a.not.some(test)) return false;
  return true;
}

export type BenchLine = {
  id: string;
  cat: string;
  q: string;
  route: RouteScore;
  got: string;
  args?: Record<string, unknown>;
  answerOk?: boolean | null;
  text?: string;
  /** Milliseconds: routing step (rules + model router), first words, whole answer. */
  routeMs?: number;
  firstMs?: number;
  totalMs?: number;
};

/** Totals per category: route passes and answer passes. */
export function summarise(lines: BenchLine[]) {
  const by: Record<
    string,
    { n: number; route: number; answered: number; answerOk: number; [k: string]: number }
  > = {};
  for (const l of lines) {
    const s = (by[l.cat] ??= { n: 0, route: 0, answered: 0, answerOk: 0 });
    const all = (by.all ??= { n: 0, route: 0, answered: 0, answerOk: 0 });
    for (const x of [s, all]) {
      x.n++;
      if (l.route === 'pass') x.route++;
      x[l.route] = (x[l.route] ?? 0) + 1;
      if (l.answerOk !== undefined && l.answerOk !== null) {
        x.answered++;
        if (l.answerOk) x.answerOk++;
      }
    }
  }
  return by;
}

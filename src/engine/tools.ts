/**
 * The model-driven action layer (tools-logic.ts has the catalog). For a request the rules didn't
 * recognise, the model picks a tool and its arguments; the call is checked against the schema and
 * run through the same handlers the rules use (draft cards, read-back and countdowns unchanged).
 * Up to MAX_TOOL_STEPS calls chain when one result feeds the next ("text Sam when my dentist
 * is": search memory → message). Anything else falls back to the normal answer.
 */
import { Linking } from 'react-native';
import { planIntent } from './actions';
import { feedbackIntent, parseFeedback, supportEmail } from './feedback';
import { askLlm } from './llm';
import {
  isCompound,
  MAX_TOOL_STEPS,
  parseRangeReply,
  parseToolReply,
  rangePrompt,
  relevantTools,
  ROUTER_SYSTEM,
  routerPrompt,
  toolByName,
  type ToolCall,
  type ToolSpec,
  type ToolStep,
  type Validated,
  validateCall,
  wantsModelRange,
} from './tools-logic';
import { runParsedCommand } from './quick-commands';
import { cameraChangeFor } from './camera-settings-logic';
import { runExtra } from '@/integrations/extras';
import type { Extra, RideApp, SearchApp } from '@/integrations/extras-logic';
import { runControl } from '@/integrations/phone-controls';
import type { Control, PanelKind } from '@/integrations/phone-controls-logic';
import type { MediaCommand } from '@/integrations/native';
import type { Intent } from '@/integrations/parse';
import { isOn } from '@/integrations/prefs';
import type { MessageApp, PlannedAction } from '@/integrations/types';
import { parseWhen } from '@/memory/followup-logic';
import { searchMemory } from '@/memory/store';
import { parseTimeRangeRules, rememberRange, type TimeRange } from '@/memory/time-range';

/** What the assistant does with a routed request. */
export type RouteOutcome =
  /** Say this (done, or an answer from a tool). */
  | { kind: 'reply'; text: string }
  /** A draft card or a done action: handled like a rule's plan (read-back, countdown). */
  | { kind: 'plan'; plan: PlannedAction }
  /** Run this canonical request through the rules (reminders, routines, location, weather). */
  | { kind: 'rules'; text: string }
  /** The normal answer path (memory search, recaps), with any time span already remembered. */
  | { kind: 'answer' };

export type RouteContext = {
  routine?: boolean;
  offRecord?: boolean;
  now?: Date;
  /** The model call; replaceable in tests. */
  ask?: (prompt: string, system: string, maxTokens: number) => Promise<string>;
  /** Runs a canonical request through the rules and returns its reply text (for chains). */
  viaRules?: (text: string) => Promise<string | null>;
  log?: (line: string) => void;
};

const defaultAsk = async (prompt: string, system: string, maxTokens: number) =>
  (await askLlm(prompt, null, () => {}, { system, maxTokens, scratch: true })).text;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Feedback by rule, no model: "send feedback: …", "tell the developers …", "report a bug …". */
export async function feedbackRule(q: string): Promise<RouteOutcome | null> {
  const text = parseFeedback(q);
  return text ? runFeedback(text) : null;
}

async function runFeedback(text: string): Promise<RouteOutcome> {
  const intent = feedbackIntent(text);
  if (!intent || intent.type !== 'email')
    return { kind: 'reply', text: "Feedback isn't set up in this version of Sidekick." };
  // Email sending off: the mail app opens with the same draft (the user presses Send there).
  if (!isOn('email', 'send')) {
    const url = `mailto:${encodeURIComponent(supportEmail())}?subject=${encodeURIComponent(intent.subject)}&body=${encodeURIComponent(intent.body)}`;
    const ok = await Linking.openURL(url).then(
      () => true,
      () => false,
    );
    return {
      kind: 'reply',
      text: ok
        ? 'Your email app is open with the feedback ready. Press Send there.'
        : 'No email app is set up on this phone.',
    };
  }
  const plan = await planIntent(intent);
  return plan ? { kind: 'plan', plan } : { kind: 'reply', text: "I couldn't start the email." };
}

/** One validated call → what to do. Info tools return their text for chaining. */
async function runTool(
  name: string,
  a: Record<string, unknown>,
  question: string,
  ctx: RouteContext,
  now: Date,
): Promise<RouteOutcome | null> {
  const intent = (i: Intent) =>
    planIntent(i, now).then((p): RouteOutcome | null => (p ? { kind: 'plan', plan: p } : null));
  const extra = (e: Extra) =>
    runExtra(e, now).then((p): RouteOutcome | null => (p ? { kind: 'plan', plan: p } : null));
  const control = (c: Control) =>
    runControl(c).then((p): RouteOutcome | null => (p ? { kind: 'plan', plan: p } : null));
  const command = (cmd: Parameters<typeof runParsedCommand>[0]) =>
    runParsedCommand(cmd, question, null).then((t): RouteOutcome | null =>
      t ? { kind: 'reply', text: t } : null,
    );
  const rules = (text: string): RouteOutcome => ({ kind: 'rules', text: text.trim() });
  switch (name) {
    case 'memory_search':
    case 'recap': {
      const from = a.from as number | undefined;
      const to = (a.to as number | undefined) ?? now.getTime();
      if (from !== undefined && from < to)
        rememberRange([question], { from, to, label: 'that time' });
      return { kind: 'answer' };
    }
    case 'message':
      return intent({
        type: 'message',
        name: str(a.to),
        text: str(a.text),
        app: (str(a.app) || 'auto') as MessageApp,
      });
    case 'email':
      return intent({ type: 'email', name: str(a.to), subject: str(a.subject), body: str(a.body) });
    case 'call':
      return intent({ type: 'call', name: str(a.to) });
    case 'event': {
      const w = parseWhen(str(a.when), now);
      if (!w)
        return { kind: 'reply', text: `When should "${str(a.title)}" be? Say a day and time.` };
      return intent({
        type: 'event',
        title: str(a.title),
        start: w.at,
        end: w.allDay ? w.at : w.at + 3_600_000,
        allDay: w.allDay,
        location: str(a.place),
      });
    }
    case 'alarm': {
      const m = /^(\d{1,2})[:.](\d{2})$/.exec(str(a.time));
      if (!m || +m[1] > 23 || +m[2] > 59) return null;
      return intent({ type: 'alarm', hour: +m[1], minute: +m[2], label: str(a.label) });
    }
    case 'timer':
      return intent({
        type: 'timer',
        seconds: Math.round((a.minutes as number) * 60),
        label: str(a.label),
      });
    case 'navigate':
      return intent({
        type: 'navigate',
        destination: str(a.destination),
        mode: (str(a.mode) || 'driving') as 'driving',
      });
    case 'media':
      return intent({ type: 'media', cmd: str(a.command) as MediaCommand });
    case 'reminder':
      return rules(`remind me to ${str(a.what)} ${str(a.when)}`);
    case 'routine':
      if (ctx.routine || ctx.offRecord) return null;
      return rules(`${str(a.when)} ${str(a.instruction)}`);
    case 'ride':
      return extra({
        type: 'ride',
        app: (str(a.app) || null) as RideApp | null,
        destination: str(a.destination) || null,
      });
    case 'app_search':
      return extra({ type: 'search', app: str(a.app) as SearchApp, query: str(a.query) });
    case 'play':
      return control({ type: 'play', query: str(a.query), app: str(a.app) || null });
    case 'open_app':
      return control({ type: 'openApp', name: str(a.name) });
    case 'phone_setting':
      return control(settingControl(a));
    case 'phone_info': {
      const day = str(a.day);
      const what = str(a.what);
      if (what === 'battery') return extra({ type: 'battery' });
      if (what === 'storage') return extra({ type: 'storage' });
      if (what === 'clipboard') return extra({ type: 'clipboardRead' });
      if (what === 'steps')
        return extra({ type: 'steps', day: day === 'yesterday' ? 'yesterday' : 'today' });
      return extra({
        type: 'screenTime',
        app: str(a.app) || null,
        range: day === 'yesterday' || day === 'week' ? day : 'today',
      });
    }
    case 'birthdays':
      return extra({
        type: 'birthday',
        name: str(a.name) || null,
        within: (str(a.within) || 'next') as 'next',
      });
    case 'find_phone':
      return extra({ type: 'findPhone' });
    case 'weather': {
      const place = str(a.place);
      return rules(`what's the weather${place ? ` in ${place}` : ''} ${str(a.day)}`);
    }
    case 'location':
      return rules(locationPhrase(str(a.question), str(a.place), str(a.when)));
    case 'name_place':
      if (ctx.offRecord) return null;
      return rules(`call this place ${str(a.name)}`);
    case 'watch':
      return command({ type: 'watch', what: str(a.thing), every: a.every === true });
    case 'stop_watching':
      return command({ type: 'unwatch', what: str(a.thing) || null });
    case 'speech_speed': {
      const pct = a.percent as number | undefined;
      const change = str(a.change);
      const rate =
        pct !== undefined
          ? pct / 100
          : change === 'faster' || change === 'slower' || change === 'normal'
            ? change
            : null;
      return rate === null ? null : command({ type: 'speed', rate });
    }
    case 'listening':
      return command({ type: 'listening', on: a.on === true });
    case 'camera':
      return command({ type: 'camera', on: a.on === true });
    case 'camera_setting':
      return command({ type: 'cameraSetting', change: cameraChangeFor(a, question) });
    case 'feedback':
      return runFeedback(str(a.text));
    case 'reply':
      return { kind: 'reply', text: str(a.text) };
    default:
      return null;
  }
}

function settingControl(a: Record<string, unknown>): Control {
  const setting = str(a.setting);
  const on = typeof a.on === 'boolean' ? a.on : null;
  const level = a.level as number | undefined;
  const change = str(a.change);
  switch (setting) {
    case 'torch':
      return { type: 'torch', on };
    case 'dnd':
      return { type: 'dnd', on: on ?? true };
    case 'brightness':
      return {
        type: 'brightness',
        percent:
          level !== undefined
            ? Math.round(level)
            : change === 'auto' || change === 'up' || change === 'down'
              ? change
              : 'up',
      };
    case 'volume':
      if (level !== undefined) return { type: 'volume', dir: 'set', percent: Math.round(level) };
      return {
        type: 'volume',
        dir: (['up', 'down', 'mute', 'unmute', 'max'].includes(change) ? change : 'up') as 'up',
      };
    default:
      return { type: 'panel', kind: setting as PanelKind, on };
  }
}

/** The location question as words the location rules read. */
export function locationPhrase(kind: string, place: string, when: string): string {
  switch (kind) {
    case 'where_was':
      return `where was I ${when || 'earlier'}`;
    case 'parked':
      return 'where did I park';
    case 'last_visit':
      return `when was I last at ${place}`;
    case 'time_at':
      return `how long was I at ${place} ${when || 'today'}`;
    case 'visited':
      return `where have I been ${when || 'this week'}`;
    default:
      return 'where am I';
  }
}

/** Text of an outcome for a chain's next step. */
async function resultText(o: RouteOutcome, ctx: RouteContext, question: string): Promise<string> {
  switch (o.kind) {
    case 'reply':
      return o.text;
    case 'plan':
      return o.plan.kind === 'reply' ? o.plan.text : `${o.plan.draft.title} (card shown)`;
    case 'rules':
      return (await ctx.viaRules?.(o.text)) ?? '';
    case 'answer': {
      const hits = await searchMemory(question, 4).catch(() => []);
      return hits.length
        ? hits.map((m) => `${new Date(m.at).toLocaleString()}: ${m.text.slice(0, 160)}`).join(' | ')
        : 'nothing found';
    }
  }
}

/**
 * Lets the model route [question] (rules already missed). Null when no tool fits, the model is
 * unsure, or a call fails validation: then the normal answer runs.
 */
export async function routeWithTools(
  question: string,
  ctx: RouteContext = {},
): Promise<RouteOutcome | null> {
  const now = ctx.now ?? new Date();
  const tools: ToolSpec[] = relevantTools(question, ctx);
  if (!tools.length) return null;
  const ask = ctx.ask ?? defaultAsk;
  const log = ctx.log ?? ((l: string) => console.log(`[router] ${l}`));
  const compound = isCompound(question);
  const steps: ToolStep[] = [];
  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const { call, v, ms } = await askRouter(question, now, tools, steps, ask);
    log(`step ${step + 1}: ${call?.tool ?? 'unparsed'} (${ms} ms, ${tools.length} tools)`);
    if (!call || call.tool === 'none' || !v) return step ? lastOutcome(steps) : null;
    if (!v.ok) {
      log(`rejected: ${v.error}`);
      return step ? lastOutcome(steps) : null;
    }
    const outcome = await runTool(call.tool, v.args, question, ctx, now).catch((e) => {
      log(`failed: ${String(e)}`);
      return null;
    });
    if (!outcome) return step ? lastOutcome(steps) : null;
    const spec = tools.find((x) => x.name === call.tool);
    // Done unless an info result feeds a compound request's next step.
    if (!compound || call.tool === 'reply' || spec?.kind === 'action') return outcome;
    steps.push({ tool: call.tool, args: v.args, result: await resultText(outcome, ctx, question) });
  }
  return lastOutcome(steps);
}

/** One router step: the model's pick for [question], checked against the offered tools. */
async function askRouter(
  question: string,
  now: Date,
  tools: ToolSpec[],
  steps: ToolStep[],
  ask: NonNullable<RouteContext['ask']>,
): Promise<{ call: ToolCall | null; v: Validated | null; ms: number }> {
  const t0 = Date.now();
  const reply = await ask(routerPrompt(question, now, tools, steps), ROUTER_SYSTEM, 140).catch(
    () => '',
  );
  const call = parseToolReply(reply);
  const v =
    call && call.tool !== 'none'
      ? validateCall(call, steps.length ? [...tools, toolByName('reply')!] : tools)
      : null;
  return { call, v, ms: Date.now() - t0 };
}

export type ToolPick = {
  offered: string[];
  tool: string | null;
  args: Record<string, unknown>;
  error?: string;
  ms: number;
};

/**
 * The router's first pick for [question] without running it (the dev answers bench): the tools
 * offered, the call and whether it passed the schema. Null when no tool would be offered.
 */
export async function pickToolOnly(
  question: string,
  ctx: Pick<RouteContext, 'routine' | 'offRecord' | 'now' | 'ask'> = {},
): Promise<ToolPick | null> {
  const tools = relevantTools(question, ctx);
  if (!tools.length) return null;
  const { call, v, ms } = await askRouter(
    question,
    ctx.now ?? new Date(),
    tools,
    [],
    ctx.ask ?? defaultAsk,
  );
  const offered = tools.map((t) => t.name);
  if (!call) return { offered, tool: null, args: {}, error: 'unparsed', ms };
  if (call.tool === 'none' || !v) return { offered, tool: 'none', args: {}, ms };
  return v.ok
    ? { offered, tool: call.tool, args: v.args, ms }
    : { offered, tool: call.tool, args: call.args, error: v.error, ms };
}

function lastOutcome(steps: ToolStep[]): RouteOutcome | null {
  const last = steps[steps.length - 1];
  return last?.result ? { kind: 'reply', text: last.result } : null;
}

/**
 * Time words the rules can't read ("over Christmas", "the fortnight before last"): the model
 * gives from/to once, which is checked and remembered for this question (time-range.ts), so
 * search, recall, recaps and location all use it. Returns the span, or null.
 */
export async function resolveTimeWithModel(
  questions: string[],
  ctx: Pick<RouteContext, 'ask' | 'now'> = {},
): Promise<TimeRange | null> {
  const now = ctx.now ?? new Date();
  const q = questions[0];
  if (!wantsModelRange(q, parseTimeRangeRules(q, now))) return null;
  const ask = ctx.ask ?? defaultAsk;
  const reply = await ask(
    rangePrompt(q, now),
    'You read time spans. Reply with JSON only.',
    60,
  ).catch(() => '');
  const r = parseRangeReply(reply, now);
  if (r) rememberRange(questions, r);
  return r;
}

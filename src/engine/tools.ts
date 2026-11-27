/**
 * The model-driven action layer (tools-logic.ts has the catalog). Once the model has chosen a
 * tool (decide.ts), it fills that tool's arguments; the call is checked against the schema and
 * run through the app's handlers (draft cards, read-back and countdowns). Words the model gives
 * a handler (times, places) are read by code that computes, never to guess what was meant.
 */
import { Linking } from 'react-native';
import { moveEventTo, planIntent, planTelephony, scheduleDraft } from './actions';
import { feedbackIntent, supportEmail } from './feedback';
import { openInterpreter } from './interpreter';
import { askLlm } from './llm';
import {
  parseRangeReply,
  fillPrompt,
  parseFillReply,
  rangePrompt,
  ROUTER_SYSTEM,
  TO_USER,
  toolByName,
  validateCall,
  wantsModelRange,
} from './tools-logic';
import { runParsedCommand } from './quick-commands';
import { editCall, type EditCall } from './photo-edit-logic';
import { cameraChangeFor } from './camera-settings-logic';
import { runExtra } from '@/integrations/extras';
import type { Extra, RideApp, SearchApp } from '@/integrations/extras-logic';
import { runControl } from '@/integrations/phone-controls';
import type { Control, PanelKind } from '@/integrations/phone-controls-logic';
import type { MediaCommand } from '@/integrations/native';
import type { Intent } from '@/integrations/parse';
import { isOn } from '@/integrations/prefs';
import { spanLabel, type RecapRequest } from '@/memory/recap-logic';
import type { MessageApp, PlannedAction } from '@/integrations/types';
import { parseWhen } from '@/memory/followup-logic';
import { saveFact } from '@/memory/store';
import { contactDetails } from '@/memory/sources';
import {
  calculateTool,
  convertTool,
  dateTool,
  timeInTool,
  type DateArgs,
} from '@/integrations/compute';
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
  /**
   * Answer normally; clipboard: with the copied text added (extras.ts); recording: the saved
   * recording of the heard line it finds is shown with the answer, to play.
   */
  | { kind: 'answer'; clipboard?: boolean; recording?: boolean }
  /** Several web searches and a short report with sources (src/web/research.ts). */
  | { kind: 'research'; topic: string; news?: boolean }
  /** An edited copy of the photo sent with the request (photo-edit.ts). */
  | { kind: 'edit_photo'; edit: EditCall }
  /** A new picture drawn on the phone from [prompt] (picture.ts). */
  | { kind: 'picture'; prompt: string }
  /** Translate [text] (empty: the text in the photo) into [to]: the assistant runs the model. */
  | { kind: 'translate'; text: string; to: string }
  | { kind: 'recap'; req: RecapRequest };

export type RouteContext = {
  routine?: boolean;
  offRecord?: boolean;
  now?: Date;
  /** The model call; replaceable in tests. */
  ask?: (prompt: string, system: string, maxTokens: number) => Promise<string>;
  log?: (line: string) => void;
};

const defaultAsk = async (prompt: string, system: string, maxTokens: number) =>
  (await askLlm(prompt, null, () => {}, { system, maxTokens, scratch: true })).text;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const computed = (text: string | null, fail: string): RouteOutcome => ({
  kind: 'reply',
  text: text ?? fail,
});

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
export async function runTool(
  name: string,
  a: Record<string, unknown>,
  question: string,
  ctx: RouteContext,
  now: Date = new Date(),
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
    case 'memory_search': {
      const from = a.from as number | undefined;
      const to = (a.to as number | undefined) ?? now.getTime();
      if (from !== undefined && from < to)
        rememberRange([question], { from, to, label: 'that time' });
      return { kind: 'answer' };
    }
    case 'research':
      return { kind: 'research', topic: str(a.topic) || question, news: a.news === true };
    case 'edit_photo': {
      const edit = editCall(a);
      return edit ? { kind: 'edit_photo', edit } : null;
    }
    case 'make_picture':
      return { kind: 'picture', prompt: str(a.prompt) };
    case 'recap': {
      const from = a.from as number | undefined;
      const to = (a.to as number | undefined) ?? now.getTime();
      const topic = str(a.topic) || null;
      const range =
        from !== undefined && from < to
          ? { from, to, label: spanLabel(from, to, now.getTime()) }
          : null;
      // A topic with no span: the latest stretch about it ("recap what we've been working on").
      return { kind: 'recap', req: { range, topic, stretch: !range && !!topic } };
    }
    case 'message':
    case 'email': {
      // "Text Sam at 6pm …": the draft waits in the outbox until then.
      const at = str(a.at) ? parseWhen(str(a.at), now) : null;
      if (str(a.at) && (!at || at.at <= now.getTime()))
        return { kind: 'reply', text: 'When should it go? Say a time later today or after.' };
      const i: Intent =
        name === 'message'
          ? {
              type: 'message',
              name: str(a.to),
              text: str(a.text),
              app: (str(a.app) || 'auto') as MessageApp,
            }
          : { type: 'email', name: str(a.to), subject: str(a.subject), body: str(a.body) };
      const plan = await planIntent(i, now);
      const p = at ? scheduleDraft(plan, at.at) : plan;
      return p ? { kind: 'plan', plan: p } : null;
    }
    case 'clipboard':
      return { kind: 'answer', clipboard: true };
    case 'play_recording':
      return { kind: 'answer', recording: true };
    case 'move_event': {
      const p = await moveEventTo(str(a.event), str(a.to), now);
      return p ? { kind: 'plan', plan: p } : null;
    }
    case 'texts':
    case 'calls':
    case 'call_back': {
      const range = str(a.when) ? parseTimeRangeRules(str(a.when), now) : null;
      const who = str(a.from) || null;
      const p = await planTelephony(
        name === 'texts'
          ? { type: 'texts', name: who, last: a.last === true, unread: a.unread === true, range }
          : name === 'calls'
            ? { type: 'calls', name: who, missed: a.missed === true, range }
            : { type: 'callBack' },
        now,
      );
      return p
        ? { kind: 'plan', plan: p }
        : {
            kind: 'reply',
            text: 'Reading texts and calls needs Sidekick as the default assistant.',
          };
    }
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
      return intent(
        a.command === 'what'
          ? { type: 'nowPlaying' }
          : { type: 'media', cmd: str(a.command) as MediaCommand },
      );
    case 'draft':
      return intent(a.do === 'send' ? { type: 'sendIt' } : { type: 'cancelIt' });
    case 'reply_message':
      return intent({ type: 'reply', name: str(a.to) || null, text: str(a.text) });
    case 'read_messages':
      return intent({ type: 'readMessages', name: str(a.from) || null });
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
      return extra(a.stop === true ? { type: 'stopRing' } : { type: 'findPhone' });
    case 'missed':
      return intent({ type: 'missed' });
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
    case 'calculate':
      return computed(calculateTool(str(a.expression)), "I couldn't work that sum out.");
    case 'convert':
      return computed(
        convertTool(a.amount as number, str(a.from), str(a.to)),
        "I can't convert between those units.",
      );
    case 'date':
      return computed(dateTool(a as DateArgs, now), "I couldn't work that date out.");
    case 'time_in':
      return computed(
        timeInTool(str(a.place), now),
        `I don't know the time zone of ${str(a.place)}.`,
      );
    case 'remember':
      if (ctx.offRecord)
        return {
          kind: 'reply',
          text: "You're off the record, so I won't keep that. Leave Off the record and say it again.",
        };
      await saveFact(str(a.fact).replace(/[.!]+$/, ''));
      return { kind: 'reply', text: "Got it, I'll remember that." };
    case 'translate':
      if (a.talk === true && !ctx.routine)
        return { kind: 'reply', text: openInterpreter(str(a.to)) };
      return { kind: 'translate', text: str(a.text), to: str(a.to) };
    case 'repeat':
      return command({ type: 'repeat' });
    case 'help':
      return command({ type: 'help' });
    case 'scan':
      return command({ type: 'scan' });
    case 'list_watches':
      return command({ type: 'watchList' });
    case 'contact_number':
      return { kind: 'reply', text: await contactDetails(str(a.name)) };
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

export type ToolPick = {
  offered: string[];
  tool: string | null;
  args: Record<string, unknown>;
  error?: string;
  /** The model's last reply, when it declined or the call was refused (for benches). */
  reply?: string;
  ms: number;
};

/**
 * The arguments for the one tool the model chose (decide-logic.ts), checked against its schema.
 * The model may still decline ({"none":true}) when, seeing the tool's details, it doesn't fit.
 */
export async function fillTool(
  question: string,
  tool: string,
  ctx: Pick<RouteContext, 'now' | 'ask'> = {},
): Promise<ToolPick | null> {
  const spec = toolByName(tool);
  if (!spec) return null;
  const t0 = Date.now();
  const ask = ctx.ask ?? defaultAsk;
  const prompt = fillPrompt(question, ctx.now ?? new Date(), spec);
  type Try = { reply: string; none?: boolean; args?: Record<string, unknown>; error?: string };
  const tryOnce = async (p: string): Promise<Try> => {
    const reply = await ask(p, ROUTER_SYSTEM, 140).catch(() => '');
    const call = parseFillReply(reply, tool);
    if (!call) return { reply, error: 'unparsed' };
    if (call.tool === 'none') return { reply, none: true };
    const v = validateCall(call, [spec]);
    return v.ok ? { reply, args: v.args } : { reply, error: v.error, args: call.args };
  };
  let r = await tryOnce(prompt);
  // A call the schema refuses (a made-up argument name, a value outside the list) is asked once
  // more with the reason, so the model corrects it. A message to the user is refused on purpose.
  if (r.error && r.error !== TO_USER)
    r = await tryOnce(
      `${prompt}\nYour reply ${r.reply.trim().slice(0, 200)} was refused: ${r.error}. Reply again.`,
    );
  const ms = Date.now() - t0;
  const reply = r.reply.trim().slice(0, 200);
  if (r.none) return { offered: [tool], tool: 'none', args: {}, reply, ms };
  if (!r.error) return { offered: [tool], tool, args: r.args ?? {}, ms };
  return {
    offered: [tool],
    tool: r.error === 'unparsed' ? null : tool,
    args: r.args ?? {},
    error: r.error,
    reply,
    ms,
  };
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

/**
 * The model decides what a request needs: an answer, an online lookup, or one phone tool. No
 * word lists: a short pass whose system prompt is the tool list with one line each
 * (catalogSystem, kept read in a prefix cache) replies with one word; the tool's arguments are
 * then filled by the model for that one tool (tools.ts fillTool) and checked against its schema.
 *
 * Measured against the word lists this replaced in docs/BENCH.md ("Rules vs model, thinking").
 * Pure; tested in __tests__/decide-test.ts.
 */
import { TOOLS, type ToolSpec } from './tools-logic';

/**
 * Tools the model can name: everything that acts or reads the phone, and recaps (their own
 * summary of a span). Plain memory questions are answers: the answer prompt searches memory.
 */
export const DECIDE_TOOLS: ToolSpec[] = TOOLS.filter(
  (t) => t.kind !== 'answer' || t.name === 'recap',
);

/**
 * What may run while the phone is locked (hands-free, screen off): nothing personal. Checked on
 * the model's filled call, so it holds in any wording: timers, alarms, sums and dates, the
 * torch and volume, battery, ringing the phone, speech speed, the camera, and stopping listening.
 */
export function lockSafe(tool: string, args: Record<string, unknown>): boolean {
  switch (tool) {
    case 'timer':
    case 'alarm':
    case 'calculate':
    case 'convert':
    case 'date':
    case 'time_in':
    case 'speech_speed':
    case 'camera':
    case 'find_phone':
      return true;
    case 'phone_setting':
      return args.setting === 'torch' || args.setting === 'volume';
    case 'phone_info':
      return args.what === 'battery';
    case 'listening':
      return args.on === false;
    default:
      return false;
  }
}

const names = (tools: ToolSpec[]) => tools.map((t) => t.name).join(', ');

/** Added to the system prompt: one sentence and the tool names (about 90 tokens). */
export function decideHint(tools: ToolSpec[] = DECIDE_TOOLS): string {
  return (
    ' If the user wants the phone to do something for them (not just an answer or some writing), ' +
    `reply with only DO and the tool's name, from: ${names(tools)}.`
  );
}

export type Decision =
  | { kind: 'answer' }
  /** news: headlines (news feeds are searched too). */
  | { kind: 'lookup'; news?: boolean }
  | { kind: 'do'; tool: string };

const DO = /^\W*DO\W+([a-z_]+)\b/i;

/** The model's reply as a decision; an answer unless it is a marker naming a known tool. */
export function parseDecision(text: string, tools: ToolSpec[] = DECIDE_TOOLS): Decision {
  const t = text.trim();
  const m = DO.exec(t);
  if (m && t.length <= 60) {
    const tool = m[1].toLowerCase();
    if (tools.some((x) => x.name === tool)) return { kind: 'do', tool };
  }
  if ((/^\W*lookup\b/i.test(t) && t.length <= 40) || /\bLOOKUP\W*$/.test(t))
    return { kind: 'lookup' };
  return { kind: 'answer' };
}

/**
 * Thinking hand-off (measured in docs/BENCH.md): the model replies THINK when a question needs
 * careful working, and is then asked again with thinking on. No word lists decide it.
 */
export const THINK_HINT =
  ' If answering well needs careful step-by-step working that you could get wrong at a glance ' +
  '(several calculation steps, a logic puzzle, fitting a plan around times), reply with only THINK.';

/**
 * The reply is the THINK marker: alone (any case, possibly with punctuation or formatting), or
 * in capitals at the start of a longer reply. On the phone the model wrote "THINK" and then its
 * working, so the marker alone never matched (27 Nov).
 */
export function wantsThinking(text: string): boolean {
  const t = text.trim();
  return /^\W*THINK\b/.test(t) || (t.length <= 20 && /^\W*THINK\W*$/i.test(t));
}

// --- Variants measured on the phone and not used (kept for the bench, docs/BENCH.md) ---

/** A separate one-word classification pass (variant "classify"). */
export function classifySystem(tools: ToolSpec[] = DECIDE_TOOLS): string {
  return (
    'Classify the request to a phone assistant. Reply with one word only: answer (a question, ' +
    'a chat, or a request for some writing), lookup (needs current facts from the internet), or ' +
    `the phone tool that does it: ${names(tools)}.`
  );
}

/**
 * The classifier with each tool's one-line description (variant "catalog"): read once and kept
 * (the prefix cache), so a question costs only its own words and one word of reply.
 */
export function catalogSystem(tools: ToolSpec[] = DECIDE_TOOLS, lookup = true): string {
  return (
    'You sort requests to a phone assistant. Reply with one word only.\n' +
    'answer: a question, a chat, advice, or a request to write, explain or plan something; also ' +
    'questions about what I saw, heard, said or noted, recaps, and questions about a photo that ' +
    'comes with the request.\n' +
    (lookup
      ? 'lookup: needs current facts from the internet (prices, scores, recent events).\n' +
        'news: the latest news or headlines, in general or on a topic.\n'
      : '') +
    'Or the phone tool that does what I ask:\n' +
    tools.map((t) => `${t.name}: ${t.desc}`).join('\n') +
    '\nPick a tool only when I want the phone to do that now; talking about a thing is answer. ' +
    'Asking you to text, call or email me myself is answer (you reply here).'
  );
}

/**
 * The request as the sorter reads it. A photo taken or shared with it is said, from the app's
 * state: without it "What is this?" read as a question about what is playing (the media tool), and
 * a photo question on the iPhone Simulator was answered "That isn't possible on this phone yet."
 */
export function requestLine(question: string, photo = false): string {
  return photo ? `Request (with a photo): ${question}` : `Request: ${question}`;
}

/** The sorter's one word → a decision. A tool name inside it ("stop_listening") counts. */
export function parseClassify(text: string, tools: ToolSpec[] = DECIDE_TOOLS): Decision {
  const w = /[a-z_]+/i.exec(text.trim())?.[0]?.toLowerCase() ?? '';
  if (w === 'lookup') return { kind: 'lookup' };
  if (w === 'news') return { kind: 'lookup', news: true };
  if (tools.some((x) => x.name === w)) return { kind: 'do', tool: w };
  const inside = tools
    .filter((x) => w.split('_').length > 1 && w.includes(x.name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (inside) return { kind: 'do', tool: inside.name };
  // A tool's main choice instead of its name ("upscale" for edit_photo, seen on the phone).
  const byChoice = tools.filter((x) =>
    Object.values(x.args).some((a) => a.required && a.values?.includes(w)),
  );
  if (byChoice.length === 1) return { kind: 'do', tool: byChoice[0].name };
  return { kind: 'answer' };
}

/** The label a bench line is scored by: "answer", "lookup" or "do:<tool>". */
export function decisionLabel(d: Decision): string {
  return d.kind === 'do' ? `do:${d.tool}` : d.kind;
}

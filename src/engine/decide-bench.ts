/**
 * Dev-only bench for "rules vs model" and thinking mode (docs/BENCH.md). Run on the phone from
 * the speed-test screen's deep link: sidekick://bench?run=decide&variant=catalog|catalog-off|
 * catalog-fill|app|classify|fused|fused-lookup|full|embed (app: the chat's own path end to end,
 * the tools offered without a photo, lookup lines on, then the chosen tool's arguments), run=thinking&variant=0|256|1024|-1|
 * default|handoff, or run=background&variant=<budget>. Nothing is done: each request is only
 * classified (or answered in a throwaway chat). One JSON line per case on logcat:
 * `[decide] {...}` / `[think] {...}`. The model is unloaded at the end so the app's own chat
 * starts again from its saved summary.
 */
import SidekickNative from '../../modules/sidekick-native';
import { CASES } from '../../bench/answers/cases';
import { inPart } from './bench-part';
import { DECIDE_CASES } from '../../bench/answers/decide-cases';
import { THINK_CASES } from '../../bench/answers/thinking-cases';
import { BG_CASES, type BgCase } from '../../bench/answers/background-cases';
import { notePrompt } from '@/memory/conversation-note-logic';
import { factPrompt } from '@/memory/fact-extraction';
import { namePrompt } from '@/memory/names';
import { recapPrompt } from '@/memory/recap-logic';
import { DESCRIBE_PROMPT } from '@/memory/photo-text';
import {
  THINK_HINT,
  wantsThinking,
  catalogSystem,
  classifySystem,
  DECIDE_TOOLS,
  decideHint,
  decisionLabel,
  parseClassify,
  parseDecision,
  type Decision,
} from './decide-logic';
import { decideRequest } from './decide';
import { EMBEDDER_FILE } from './models';
import { modelPath } from './downloads';
import { askLlm, unloadLlm } from './llm';
import { questionPart, SYSTEM_PROMPT } from './prompts';
import { catalogText, parseToolReply, TOOLS, toolByName } from './tools-logic';
import { fillTool } from './tools';
import { EMBED_DIMS } from '@/memory/db';

type Log = (line: string) => void;

/** The app's old in-answer lookup hint, kept for the fused variants (docs/BENCH.md). */
const LOOKUP_HINT =
  'If answering well needs facts from the internet that you do not know, reply with only the ' +
  'word LOOKUP.\n';

/** Rule-only routes the model has no tool for (scored only for the rules). */
const RULE_ONLY = new Set<string>([]);
const RENAMED: Record<string, string> = { contact: 'contact_number' };
const COMPUTE = ['do:calculate', 'do:convert', 'do:date', 'do:time_in', 'answer'];

/** A bench case's allowed decisions, or null when only a rule can do it. */
export function wantedLabels(route: string, lookup?: string): string[] | null {
  const out = new Set<string>();
  for (const r of route.split('|')) {
    if (RULE_ONLY.has(r)) continue;
    if (r === 'quick_answer') COMPUTE.forEach((x) => out.add(x));
    else if (r === 'recap') ['answer', 'do:recap'].forEach((x) => out.add(x));
    else if (r === 'none' || r === 'memory_search') out.add('answer');
    else out.add(`do:${RENAMED[r] ?? r}`);
  }
  if (lookup === 'lookup') out.add('lookup');
  return out.size ? [...out] : null;
}

type Item = { id: string; set: string; q: string; want: string[] | null; kind?: string };

function items(): Item[] {
  return [
    ...CASES.map((c) => ({
      id: c.id,
      set: 'main',
      q: c.q,
      want: wantedLabels(c.route, c.lookup),
      kind: c.cat,
    })),
    ...DECIDE_CASES.map((c) => ({
      id: c.id,
      set: 'new',
      q: c.q,
      want: c.want.split('|'),
      kind: c.kind,
    })),
  ];
}

const fullCatalog = () =>
  ` Phone tools:\n${catalogText(TOOLS.filter((t) => t.name !== 'reply'))}\nTo use one, reply ` +
  'with only {"tool":"<name>","args":{...}}; otherwise answer normally.';

/** One fresh turn from a prefilled system prompt (the chat's base is cloned: no re-reading it). */
async function ask(prompt: string, system: string, maxTokens: number, thinkingBudget?: number) {
  const t0 = Date.now();
  let first = 0;
  const r = await askLlm(
    prompt,
    null,
    () => {
      if (!first) first = Date.now() - t0;
    },
    { system, maxTokens, keepHistory: false, thinkingBudget },
  );
  return {
    text: r.text,
    stats: r.stats,
    firstMs: r.stats.firstTextMs || first,
    ms: Date.now() - t0,
  };
}

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

export async function runDecideBench(
  log: Log,
  variant: string,
  only?: string,
  part?: string,
): Promise<void> {
  const all = items()
    .filter((x) => !only || only.split(',').some((p) => x.id.startsWith(p)))
    .filter((_, i) => inPart(i, part));
  let ok = 0;
  let scored = 0;
  let totalMs = 0;
  // The app's sorter offers the photo and picture tools only with a photo / the picture model.
  const appTools = DECIDE_TOOLS.filter(
    (t) => t.name !== 'draft' && t.name !== 'edit_photo' && t.name !== 'make_picture',
  );
  const system =
    variant === 'app'
      ? catalogSystem(appTools)
      : variant === 'catalog' || variant === 'catalog-off' || variant === 'catalog-fill'
        ? catalogSystem(undefined, variant === 'catalog')
        : variant === 'classify'
          ? classifySystem()
          : variant === 'full'
            ? SYSTEM_PROMPT + fullCatalog()
            : SYSTEM_PROMPT + decideHint();
  // The system prompt's size (read once per chat): a scratch turn re-reads it.
  if (variant !== 'embed') {
    const probe = await askLlm('Hi', null, () => {}, { system, maxTokens: 1, scratch: true });
    log(
      `[decide] system ${JSON.stringify({ variant, chars: system.length, tokens: probe.stats.prefillTokens })}`,
    );
  }
  // Embedding variant: every main case is a labelled example; new cases are held out, main ones
  // are scored leave-one-out.
  let examples: { id: string; v: number[]; label: string }[] = [];
  if (variant === 'embed') {
    const main = items().filter((x) => x.set === 'main' && x.want);
    const t0 = Date.now();
    const vs = await SidekickNative.embed(
      modelPath(EMBEDDER_FILE),
      main.map((x) => `task: classification | query: ${x.q}`),
      EMBED_DIMS,
    );
    examples = main.map((x, i) => ({ id: x.id, v: vs[i], label: x.want![0] }));
    log(`[decide] embedded ${main.length} examples in ${Date.now() - t0} ms`);
  }
  for (const it of all) {
    let d: Decision = { kind: 'answer' };
    let ms = 0;
    let extra: Record<string, unknown> = {};
    try {
      if (variant === 'embed') {
        const t0 = Date.now();
        const [v] = await SidekickNative.embed(
          modelPath(EMBEDDER_FILE),
          [`task: classification | query: ${it.q}`],
          EMBED_DIMS,
        );
        ms = Date.now() - t0;
        const best = examples
          .filter((e) => e.id !== it.id)
          .map((e) => ({ e, s: cosine(v, e.v) }))
          .sort((a, b) => b.s - a.s)[0];
        const l = best?.e.label ?? 'answer';
        d = l.startsWith('do:')
          ? { kind: 'do', tool: l.slice(3) }
          : l === 'lookup'
            ? { kind: 'lookup' }
            : { kind: 'answer' };
        extra = { nearest: best?.e.id, sim: Number(best?.s.toFixed(3)) };
      } else if (variant === 'classify' || variant.startsWith('catalog') || variant === 'app') {
        if (variant === 'app') {
          // The app's own call (cached catalog prompt, scratch chat).
          const r = await decideRequest(it.q);
          d = r.decision;
          ms = r.ms;
          extra = { reply: r.reply };
        } else {
          const r = await ask(`Request: ${it.q}`, system, 5);
          d = parseClassify(r.text);
          ms = r.ms;
          extra = { reply: r.text.slice(0, 30), prefill: r.stats.prefillTokens };
        }
        // The whole path: the chosen tool's arguments from the one-tool router, which may
        // still say none. Only a valid call counts as acting.
        if ((variant === 'catalog-fill' || variant === 'app') && d.kind === 'do') {
          const fill = await fillTool(it.q, d.tool, { now: new Date() }).catch(() => null);
          ms += fill?.ms ?? 0;
          extra = { ...extra, filled: fill?.tool, fillError: fill?.error, args: fill?.args };
          if (!fill || fill.tool !== d.tool || fill.error) d = { kind: 'answer' };
        }
      } else if (variant === 'full') {
        const r = await ask(questionPart(it.q), system, 60);
        const call = /^\s*(```(json)?\s*)?\{/.test(r.text) ? parseToolReply(r.text) : null;
        d =
          call && toolByName(call.tool) && call.tool !== 'memory_search' && call.tool !== 'recap'
            ? { kind: 'do', tool: call.tool }
            : { kind: 'answer' };
        ms = d.kind === 'do' ? r.ms : r.firstMs;
        extra = { reply: r.text.slice(0, 80), prefill: r.stats.prefillTokens };
      } else {
        const lookupOn = variant === 'fused-lookup';
        const r = await ask((lookupOn ? LOOKUP_HINT : '') + questionPart(it.q), system, 8);
        d = parseDecision(r.text);
        ms = d.kind === 'answer' ? r.firstMs : r.ms;
        extra = { reply: r.text.slice(0, 40), prefill: r.stats.prefillTokens };
      }
    } catch (e) {
      extra = { error: String(e) };
    }
    const got = decisionLabel(d);
    // Lookup off: "answer" is right for a lookup question (no internet is offered).
    const want =
      it.want &&
      variant !== 'fused-lookup' &&
      variant !== 'classify' &&
      variant !== 'catalog' &&
      variant !== 'app'
        ? it.want.filter((w) => w !== 'lookup')
        : it.want;
    const want2 = want && !want.length ? ['answer'] : want;
    const right = want2 ? want2.includes(got) : null;
    if (right !== null) {
      scored++;
      if (right) ok++;
    }
    totalMs += ms;
    log(
      `[decide] ${JSON.stringify({ variant, id: it.id, set: it.set, kind: it.kind, want: want2, got, right, ms, ...extra })}`,
    );
  }
  log(
    `[decide] summary ${JSON.stringify({ variant, ok, scored, avgMs: Math.round(totalMs / Math.max(1, all.length)) })}`,
  );
  await unloadLlm();
}

const checks = (text: string, any: string[], not: string[] = []) =>
  any.some((p) => new RegExp(p, 'i').test(text)) && !not.some((p) => new RegExp(p, 'i').test(text));

const budgetOf = (budget: string) => (budget === 'default' ? undefined : Number(budget));
const tokensFor = (b: number | undefined, answer: number) =>
  (b === undefined || b === 0 ? 0 : b < 0 ? 2048 : b) + answer;
const picked = <T extends { id: string }>(xs: T[], only?: string) =>
  xs.filter((x) => !only || only.split(',').some((p) => x.id.startsWith(p)));

/**
 * Each thinking case with the given budget ("default" = the library default), or "handoff": the
 * model itself says THINK when a question needs careful working, and only then is it asked
 * again with thinking on (budget 1024). The everyday answer cases of the main bench are also
 * asked in "handoff", to count needless THINKs.
 */
export async function runThinkingBench(log: Log, budget: string, only?: string): Promise<void> {
  const handoff = budget === 'handoff';
  const b = handoff ? 1024 : budgetOf(budget);
  const system = handoff ? SYSTEM_PROMPT + THINK_HINT : SYSTEM_PROMPT;
  let ok = 0;
  let n = 0;
  for (const c of picked(THINK_CASES, only)) {
    n++;
    try {
      // Hand-off: a first pass without thinking, asked again with it only when it says THINK.
      let r = handoff
        ? await ask(questionPart(c.q), system, 300)
        : await ask(questionPart(c.q), system, tokensFor(b, 320), b);
      let flagged = false;
      let firstMs = r.firstMs;
      let ms = r.ms;
      if (handoff) {
        flagged = wantsThinking(r.text);
        if (flagged) {
          const again = await ask(questionPart(c.q), SYSTEM_PROMPT, tokensFor(b, 320), b);
          firstMs = ms + again.firstMs;
          ms += again.ms;
          r = again;
        }
      }
      const right = checks(r.text, c.any, c.not);
      if (right) ok++;
      log(
        `[think] ${JSON.stringify({ budget, id: c.id, hard: c.hard, right, flagged, firstMs, ms, thought: r.stats.thoughtChars ?? 0, decode: r.stats.decodeTokens, text: r.text.replace(/\s+/g, ' ').slice(0, 240) })}`,
      );
    } catch (e) {
      log(`[think] ${JSON.stringify({ budget, id: c.id, error: String(e) })}`);
    }
  }
  if (handoff && !only) {
    let flags = 0;
    const everyday = CASES.filter((c) => c.route === 'none');
    for (const c of everyday) {
      const r = await ask(questionPart(c.q), system, 8).catch(() => null);
      const f = !!r && wantsThinking(r.text);
      if (f) flags++;
      log(`[think] ${JSON.stringify({ budget, id: c.id, everyday: true, flagged: f, ms: r?.ms })}`);
    }
    log(`[think] everyday ${JSON.stringify({ flags, of: everyday.length })}`);
  }
  log(`[think] summary ${JSON.stringify({ budget, ok, of: n })}`);
  await unloadLlm();
}

/** Prompt input for a background case, through the app's own prompt builders. */
function bgPrompt(c: BgCase, now: number): string | null {
  const lines = c.input.map((s, i) => {
    const [who, ...rest] = s.split(': ');
    return {
      id: i + 1,
      at: now - (c.input.length - i) * 60_000,
      who,
      text: rest.join(': '),
      isOwner: who === 'Me',
    };
  });
  const convo = { from: lines[0].at, to: lines[lines.length - 1].at, lines };
  switch (c.task) {
    case 'notes':
      return notePrompt(convo);
    case 'facts':
      return factPrompt(lines.filter((l) => l.isOwner).map((l) => l.text));
    case 'names':
      return namePrompt(lines);
    case 'recap':
      return recapPrompt('today', null, convo, [], lines);
    case 'photo':
      return DESCRIBE_PROMPT;
  }
}

const BG_TOKENS: Record<BgCase['task'], number> = {
  notes: 240,
  facts: 120,
  names: 80,
  recap: 400,
  photo: 120,
};

/**
 * Background tasks (conversation notes, fact suggestions, who-is-who, recaps, photo reading) with
 * the given thinking budget, in throwaway chats like the app's background passes. Photos are read
 * from [photoDir] (pushed by run-decide.sh). Score: share of the case's checks met.
 */
export async function runBackgroundBench(
  log: Log,
  budget: string,
  photoDir: string,
  only?: string,
): Promise<void> {
  const b = budgetOf(budget);
  let ok = 0;
  let n = 0;
  for (const c of picked(BG_CASES, only)) {
    n++;
    try {
      const prompt = bgPrompt(c, Date.now())!;
      const image = c.task === 'photo' ? `${photoDir}/${c.input[0]}` : null;
      const t0 = Date.now();
      const r = await askLlm(prompt, image, () => {}, {
        maxTokens: tokensFor(b, BG_TOKENS[c.task]),
        scratch: true,
        thinkingBudget: b,
      });
      const ms = Date.now() - t0;
      const met = c.all.filter((p) => new RegExp(p, 'im').test(r.text)).length;
      const bad = (c.not ?? []).filter((p) => new RegExp(p, 'im').test(r.text)).length;
      const right = met === c.all.length && !bad;
      if (right) ok++;
      log(
        `[bg] ${JSON.stringify({ budget, id: c.id, task: c.task, right, met, of: c.all.length, bad, ms, thought: r.stats.thoughtChars ?? 0, decode: r.stats.decodeTokens, text: r.text.replace(/\s+/g, ' ').slice(0, 300) })}`,
      );
    } catch (e) {
      log(`[bg] ${JSON.stringify({ budget, id: c.id, error: String(e) })}`);
    }
  }
  log(`[bg] summary ${JSON.stringify({ budget, ok, of: n })}`);
  await unloadLlm();
}

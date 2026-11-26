/**
 * Dev-only answers, routing and recall bench, run on the phone from the speed-test screen
 * (src/app/bench.tsx) or by deep link (sidekick://bench?run=answers). Nothing is done: routing
 * is traced (rules) or asked of the model without running the tool, answers use throwaway chats,
 * and recall questions run off the record with actions reported, not done. One JSON line per
 * case on logcat: `[answers] {...}` / `[recall] {...}`.
 */
import { CASES, type BenchCase } from '../../bench/answers/cases';
import { benchMemories, recallQuestions } from '../../bench/recall/generate';
import {
  canonFromCall,
  canonFromTrace,
  scoreAnswer,
  scoreRoute,
  summarise,
  type BenchLine,
  type Canon,
} from './answers-bench-logic';
import { answer, leaveOffTheRecord } from './assistant';
import { askLlm } from './llm';
import { questionPart, SYSTEM_PROMPT } from './prompts';
import { traceRules } from './route-trace-logic';
import { pickToolOnly } from './tools';
import {
  addBenchRows,
  benchKeys,
  clearBenchRows,
  storeCounts,
  type StoreCounts,
} from '@/memory/bench-data';
import { searchMemory } from '@/memory/store';

type Log = (line: string) => void;

const MAX_ANSWER_TOKENS = 200;
const ANSWERED = new Set(['none']);

async function modelAnswer(q: string, now: Date) {
  const t0 = Date.now();
  let first = 0;
  const r = await askLlm(
    questionPart(q, now),
    null,
    () => {
      if (!first) first = Date.now() - t0;
    },
    { system: SYSTEM_PROMPT, scratch: true, maxTokens: MAX_ANSWER_TOKENS },
  );
  return { text: r.text, firstMs: first || r.stats.ttftMs, totalMs: Date.now() - t0 };
}

async function runCase(c: BenchCase, log: Log): Promise<BenchLine> {
  const now = new Date();
  const t0 = Date.now();
  const trace = traceRules(c.q, now);
  let got: Canon = canonFromTrace(trace);
  let pick: Awaited<ReturnType<typeof pickToolOnly>> = null;
  if (got.tool === 'router') {
    pick = await pickToolOnly(c.q, { now }).catch(() => null);
    got =
      pick?.tool && pick.tool !== 'none' && !pick.error
        ? canonFromCall(pick.tool, pick.args)
        : { tool: 'none', args: {} };
  }
  const routeMs = Date.now() - t0;
  const line: BenchLine = {
    id: c.id,
    cat: c.cat,
    q: c.q,
    route: scoreRoute(c, got),
    got: got.tool,
    args: got.args,
    routeMs,
  };
  if (pick)
    Object.assign(line, { picked: pick.tool, pickError: pick.error, offered: pick.offered });
  if (got.tool === 'quick_answer') {
    line.text = String(got.args.text);
    line.firstMs = line.totalMs = routeMs;
    line.answerOk = scoreAnswer(c, line.text, now);
  } else if (ANSWERED.has(got.tool)) {
    const a = await modelAnswer(c.q, now).catch((e) => ({
      text: `error: ${String(e)}`,
      firstMs: 0,
      totalMs: 0,
    }));
    line.text = a.text;
    line.firstMs = routeMs + a.firstMs;
    line.totalMs = routeMs + a.totalMs;
    line.answerOk = scoreAnswer(c, a.text, now);
  }
  log(
    `[answers] ${JSON.stringify({ ...line, text: line.text?.replace(/\s+/g, ' ').slice(0, 300) })}`,
  );
  return line;
}

/** Runs the answers + routing set (optionally only ids starting with [only]). */
export async function runAnswersBench(log: Log, only?: string): Promise<BenchLine[]> {
  const lines: BenchLine[] = [];
  for (const c of CASES.filter((x) => !only || only.split(',').some((p) => x.id.startsWith(p))))
    lines.push(await runCase(c, log));
  log(`[answers] summary ${JSON.stringify(summarise(lines))}`);
  return lines;
}

// --- Recall ---

const countsLine = (label: string, c: StoreCounts) =>
  `[recall] counts ${label} ${JSON.stringify({ ownTotal: c.ownTotal, own: c.own, bench: c.bench, facts: c.facts, speakers: c.speakers, usedBytes: c.usedBytes, fileBytes: c.fileBytes })}`;

/** Adds the recall test data padded to [total] rows (removes earlier test data first). */
export async function loadRecallData(total: number, log: Log): Promise<void> {
  const before = await storeCounts();
  log(countsLine('before', before));
  const removed = await clearBenchRows();
  if (removed) log(`[recall] removed ${removed} earlier bench rows`);
  const rows = benchMemories(new Date(), total);
  const t0 = Date.now();
  const real = await addBenchRows(rows, {
    onProgress: (n) => {
      if (n % 320 === 0 || n === rows.length) log(`[recall] loaded ${n}/${rows.length}`);
    },
  });
  const after = await storeCounts();
  log(
    `[recall] load ${JSON.stringify({ rows: rows.length, embedded: real, ms: Date.now() - t0, addedBytes: after.usedBytes - before.usedBytes })}`,
  );
  log(countsLine('after', after));
}

export async function clearRecallData(log: Log): Promise<void> {
  const removed = await clearBenchRows();
  log(`[recall] removed ${removed} bench rows`);
  log(countsLine('after-clear', await storeCounts()));
}

/**
 * Asks every recall question: search alone (latency, where the answer's memory ranks) and the
 * full answer off the record. Answers are logged only when no memory of the owner's was among
 * the notes the model saw; otherwise the text is withheld (the score is still kept).
 */
export async function runRecallBench(log: Log, only?: string): Promise<void> {
  const now = new Date();
  const qs = recallQuestions(now).filter(
    (x) => !only || only.split(',').some((p) => x.id.startsWith(p)),
  );
  const counts = await storeCounts();
  let searchHits = 0;
  let top4 = 0;
  let correct = 0;
  const searchMs: number[] = [];
  for (const rq of qs) {
    const t0 = Date.now();
    const found = await searchMemory(rq.q, 6).catch(() => []);
    const ms = Date.now() - t0;
    searchMs.push(ms);
    const keys = await benchKeys(found.map((m) => m.id));
    const ranked = found.map((m) => keys.get(m.id) ?? 'own');
    const rank = ranked.findIndex((k) => rq.keys.includes(k));
    if (rank >= 0) searchHits++;
    if (rank >= 0 && rank < 4) top4++;
    const trace = traceRules(rq.q, now);
    let text = '';
    let firstMs = 0;
    let totalMs = 0;
    let ownInContext = false;
    if (['answer', 'router', 'recap', 'location', 'weather'].includes(trace.stage)) {
      leaveOffTheRecord();
      const a0 = Date.now();
      const r = await answer(
        rq.q,
        null,
        () => {
          if (!firstMs) firstMs = Date.now() - a0;
        },
        { offTheRecord: true, routine: true, dryActions: true },
      ).catch((e) => ({ text: `error: ${String(e)}`, sources: [], usedPhoto: null }));
      totalMs = Date.now() - a0;
      text = r.text;
      const srcKeys = await benchKeys(r.sources.map((m) => m.id));
      ownInContext = [...srcKeys.values()].some((k) => k === null) || !!r.usedPhoto;
    }
    const ok = rq.any.some((re) => new RegExp(re, 'i').test(text));
    if (ok) correct++;
    log(
      `[recall] ${JSON.stringify({
        id: rq.id,
        q: rq.q,
        stage: trace.stage,
        ok,
        rank,
        ranked: ranked.slice(0, 6),
        searchMs: ms,
        firstMs,
        totalMs,
        text: ownInContext
          ? '(withheld: own memories in context)'
          : text.replace(/\s+/g, ' ').slice(0, 240),
      })}`,
    );
  }
  searchMs.sort((a, b) => a - b);
  log(
    `[recall] summary ${JSON.stringify({
      questions: qs.length,
      correct,
      foundInTop6: searchHits,
      foundInTop4: top4,
      searchMsMedian: searchMs[Math.floor(searchMs.length / 2)] ?? 0,
      searchMsMax: searchMs.at(-1) ?? 0,
      benchRows: counts.bench,
      ownRows: counts.ownTotal,
    })}`,
  );
}

/** Search latency only (no model answers), for the memory-size curve. */
export async function runRecallSearchOnly(log: Log): Promise<void> {
  const now = new Date();
  const qs = recallQuestions(now);
  const counts = await storeCounts();
  const ms: number[] = [];
  let top4 = 0;
  for (const rq of qs) {
    const t0 = Date.now();
    const found = await searchMemory(rq.q, 6).catch(() => []);
    ms.push(Date.now() - t0);
    const keys = await benchKeys(found.map((m) => m.id));
    const rank = found.findIndex((m) => rq.keys.includes(keys.get(m.id) ?? 'own'));
    if (rank >= 0 && rank < 4) top4++;
  }
  ms.sort((a, b) => a - b);
  log(
    `[recall] search ${JSON.stringify({ benchRows: counts.bench, ownRows: counts.ownTotal, questions: qs.length, foundInTop4: top4, medianMs: ms[Math.floor(ms.length / 2)], p90Ms: ms[Math.floor(ms.length * 0.9)], maxMs: ms.at(-1) })}`,
  );
}

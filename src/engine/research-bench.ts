/**
 * Dev-only research bench, run from the speed-test screen (src/app/bench.tsx) or by deep link
 * (sidekick://bench?run=research[&only=<ids>]). For each made-up request: does the router pick
 * the research tool, then the research itself (runs as if Online were on; the setting is untouched). One JSON line per case on
 * logcat: `[research-bench] {...}`. Reports are logged (they are about made-up topics).
 */
import { citationsOk, coverage, RESEARCH_CASES } from '../../bench/research/cases';
import { decideRequest } from './decide';
import { fillTool } from './tools';
import { defaultDeps, research } from '@/web/research';

type Log = (line: string) => void;

export async function runResearchBench(log: Log, only?: string): Promise<void> {
  const ids = only?.split(',').filter(Boolean);
  const cases = RESEARCH_CASES.filter((c) => !ids?.length || ids.some((p) => c.id.startsWith(p)));
  const rows: { cov: number; ms: number; routed: boolean; cites: boolean }[] = [];
  for (const c of cases) {
    const t0 = Date.now();
    const d = await decideRequest(c.q).catch(() => null);
    const routed = d?.decision.kind === 'do' && d.decision.tool === 'research';
    const pick = routed ? await fillTool(c.q, 'research').catch(() => null) : null;
    const routeMs = Date.now() - t0;
    const r = await research(
      String(pick?.args.topic ?? c.q),
      () => {},
      undefined,
      { ...defaultDeps, enabled: () => true },
      pick?.args.news === true,
    );
    const cov = coverage(r.text, c.expect);
    const cites = citationsOk(r.text, r.web.length);
    rows.push({ cov, ms: r.ms, routed, cites });
    log(
      `[research-bench] ${JSON.stringify({
        id: c.id,
        routed,
        routeMs,
        topic: pick?.args.topic,
        queries: r.queries,
        sources: r.web.map((w) => w.url),
        pagesRead: r.pagesRead,
        timings: r.timings,
        ms: r.ms,
        coverage: Math.round(cov * 100) / 100,
        cites,
        words: r.text.split(/\s+/).length,
        text: r.text,
      })}`,
    );
  }
  const n = rows.length || 1;
  log(
    `[research-bench] summary ${JSON.stringify({
      cases: rows.length,
      routed: rows.filter((r) => r.routed).length,
      coverage: Math.round((rows.reduce((a, r) => a + r.cov, 0) / n) * 100) / 100,
      citesOk: rows.filter((r) => r.cites).length,
      medianMs: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
      maxMs: Math.max(...rows.map((r) => r.ms)),
    })}`,
  );
}

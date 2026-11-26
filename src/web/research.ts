/**
 * Research (lite): several searches, the pages they find read on the phone, one short report with
 * numbered sources. Started by the tool router when the model picks `research` (tools-logic.ts).
 * Needs Online on. What leaves the phone: the search words (Gemma's, with known names taken out)
 * and requests for the result pages; never memory, the chat, photos or location.
 */
import { askLlm, ensureLlm } from '@/engine/llm';
import { SYSTEM_PROMPT } from '@/engine/prompts';
import { getSettings } from '@/engine/settings';
import { listSpeakers } from '@/memory/store';

import { fetchJson, fetchText, isOnline, searchWeb, type SearchOptions } from './lookup';
import { mergeSources, USER_AGENT, type WebSource } from './lookup-logic';
import { isNewsQuestion, topicWords } from './news-logic';
import {
  cleanArticle,
  cleanReport,
  fallbackQueries,
  fetchablePage,
  htmlToText,
  MAX_PAGE_BYTES,
  MAX_PAGES,
  PAGE_TIMEOUT_MS,
  parsePlan,
  parseWikipediaArticle,
  parseWikipediaSearch,
  pickPassages,
  PLAN_MAX_TOKENS,
  planPrompt,
  progress,
  type ReadPage,
  REPORT_MAX_TOKENS,
  reportPrompt,
  reportSources,
  RESEARCH_NO_INTERNET,
  RESEARCH_NOTHING,
  RESEARCH_OFFLINE,
  siteName,
  wikipediaArticleUrl,
  wikipediaSearchUrl,
  wikipediaTitle,
} from './research-logic';

/**
 * GET a web page's HTML with a timeout; null on any failure, a non-https final address, a
 * non-HTML reply or a body over MAX_PAGE_BYTES. No cookies or credentials are sent.
 */
export async function fetchPage(
  url: string,
  timeoutMs = PAGE_TIMEOUT_MS,
  doFetch: typeof fetch = fetch,
): Promise<string | null> {
  if (!fetchablePage(url)) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      signal: ctl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': USER_AGENT },
      credentials: 'omit',
    });
    if (!res.ok || (res.url && !res.url.startsWith('https://'))) return null;
    const type = res.headers?.get?.('content-type') ?? '';
    if (type && !/html|xml/i.test(type)) return null;
    if (Number(res.headers?.get?.('content-length') ?? 0) > MAX_PAGE_BYTES) return null;
    const text = await res.text();
    return text.slice(0, MAX_PAGE_BYTES);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ResearchDeps = {
  enabled: () => boolean;
  online: () => Promise<boolean>;
  knownNames: () => Promise<string[]>;
  /** The model's reply to a prompt (plan: no streaming; report: streamed through onText). */
  ask: (prompt: string, maxTokens: number, onText?: (full: string) => void) => Promise<string>;
  /** The usual lookup sources plus more Wikipedia articles (see [researchSearch]). */
  search: (query: string, opts: SearchOptions) => Promise<WebSource[]>;
  /** A page's readable text, '' when it can't be read. */
  read: (source: WebSource) => Promise<string>;
  searxUrl: () => string;
  feeds: () => string[];
  now: () => Date;
};

/** Reads one result: a Wikipedia article through the API, anything else as HTML. */
export async function readSource(
  s: WebSource,
  get: {
    json: (u: string, t?: number) => Promise<unknown>;
    page: (u: string) => Promise<string | null>;
  } = {
    json: (u, t) => fetchJson(u, t),
    page: (u) => fetchPage(u),
  },
): Promise<string> {
  const wiki = wikipediaTitle(s.url);
  if (wiki)
    return cleanArticle(
      parseWikipediaArticle(
        await get.json(wikipediaArticleUrl(wiki.lang, wiki.title), PAGE_TIMEOUT_MS),
      ),
    );
  const html = await get.page(s.url);
  return html ? htmlToText(html) : '';
}

type Get = {
  json: (u: string, t?: number) => Promise<unknown>;
  text: (u: string) => Promise<string | null>;
};

/**
 * One research search: the quick lookup's sources (Wikipedia's top hit, DuckDuckGo, news, the
 * user's SearXNG and feeds) plus up to 3 Wikipedia articles, so each search can bring new pages.
 */
export async function researchSearch(
  query: string,
  opts: SearchOptions,
  get: Get = { json: (u, t) => fetchJson(u, t), text: (u) => fetchText(u) },
): Promise<WebSource[]> {
  const [base, wiki] = await Promise.all([
    searchWeb(query, opts, get).catch(() => [] as WebSource[]),
    opts.news && !topicWords(query).length
      ? Promise.resolve([] as WebSource[])
      : get
          .json(wikipediaSearchUrl(query))
          .then((j) => parseWikipediaSearch(j))
          .catch(() => [] as WebSource[]),
  ]);
  return mergeSources([base, wiki], 6);
}

export const defaultDeps: ResearchDeps = {
  enabled: () => getSettings().webLookup,
  online: isOnline,
  knownNames: async () =>
    (await listSpeakers().catch(() => []))
      .flatMap((s) => [s.name, s.suggestedName])
      .filter((n): n is string => !!n),
  ask: async (prompt, maxTokens, onText) => {
    await ensureLlm();
    const { text } = await askLlm(prompt, null, onText ?? (() => {}), {
      system: SYSTEM_PROMPT,
      maxTokens,
      scratch: true,
    });
    return text;
  },
  search: (q, opts) => researchSearch(q, opts),
  read: (s) => readSource(s),
  searxUrl: () => getSettings().searxngUrl,
  feeds: () => getSettings().newsFeeds,
  now: () => new Date(),
};

let stopped = 0;
/** The Stop button: the research ends after the step it is on (the model pass is cancelled too). */
export function stopResearch() {
  stopped++;
}

export type ResearchResult = {
  text: string;
  web: WebSource[];
  queries: string[];
  ms: number;
  timings: { planMs: number; searchMs: number; readMs: number; writeMs: number };
  pagesRead: number;
  /** Answered without the model (offline, nothing found). */
  local?: boolean;
};

/** Runs [fns] at most [n] at a time, keeping order. */
async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

export async function research(
  topic: string,
  onText: (full: string) => void,
  onStatus: (line: string) => void = () => {},
  deps: ResearchDeps = defaultDeps,
): Promise<ResearchResult> {
  const t0 = Date.now();
  const timings = { planMs: 0, searchMs: 0, readMs: 0, writeMs: 0 };
  const run = stopped;
  const cancelled = () => stopped !== run;
  const say = (text: string): ResearchResult => {
    onText(text);
    return { text, web: [], queries: [], ms: Date.now() - t0, timings, pagesRead: 0, local: true };
  };
  if (!deps.enabled()) return say(RESEARCH_OFFLINE);
  if (!(await deps.online())) return say(RESEARCH_NO_INTERNET);
  const names = await deps.knownNames().catch(() => [] as string[]);
  const now = deps.now();

  // 1. Plan: a few searches that together cover the request.
  onStatus(progress.planning);
  const planned = parsePlan(
    await deps.ask(planPrompt(topic, now), PLAN_MAX_TOKENS).catch(() => ''),
    names,
  );
  const queries = planned.length ? planned : fallbackQueries(topic, names);
  timings.planMs = Date.now() - t0;
  if (!queries.length || cancelled()) return say(RESEARCH_NOTHING);

  // 2. Search, one query after another (GDELT allows one request per 5 s; a gentle pace for all).
  const t1 = Date.now();
  const news = isNewsQuestion(topic);
  const found: { source: WebSource; query: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < queries.length && !cancelled(); i++) {
    onStatus(progress.searching(i + 1, queries.length, queries[i]));
    const hits = await deps
      .search(queries[i], { searx: deps.searxUrl(), news, feeds: deps.feeds(), now })
      .catch(() => [] as WebSource[]);
    for (const s of hits) {
      const key = (s.url || s.title).replace(/^https?:\/\/(www\.|m\.|en\.m\.)?/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ source: s, query: queries[i] });
    }
  }
  timings.searchMs = Date.now() - t1;
  if (!found.length || cancelled()) return say(RESEARCH_NOTHING);

  // 3. Read: the first results of each search first, so every part of the plan is covered.
  const byQuery = queries.map((q) => found.filter((f) => f.query === q));
  const order: typeof found = [];
  for (let k = 0; order.length < found.length; k++)
    for (const list of byQuery) if (list[k]) order.push(list[k]);
  const toRead = order.slice(0, MAX_PAGES);
  const t2 = Date.now();
  const pages: ReadPage[] = toRead.map((f) => ({ ...f, text: '' }));
  let done = 0;
  await pool(toRead, 3, async (f, i) => {
    if (cancelled()) return;
    pages[i].text = await deps.read(f.source).catch(() => '');
    onStatus(progress.reading(++done, toRead.length, siteName(f.source)));
  });
  timings.readMs = Date.now() - t2;
  if (cancelled()) return say('Research stopped.');

  // 4. Write: one pass over the best passages, within the model's window.
  const picked = pickPassages(pages, topic);
  if (!picked.length) return say(RESEARCH_NOTHING);
  onStatus(progress.writing(picked.length));
  const t3 = Date.now();
  const web = reportSources(picked);
  const raw = await deps.ask(reportPrompt(topic, picked, now), REPORT_MAX_TOKENS, (full) =>
    onText(cleanReport(full, picked.length)),
  );
  timings.writeMs = Date.now() - t3;
  const text = cleanReport(raw, picked.length);
  onText(text);
  const pagesRead = pages.filter((p) => p.text).length;
  // Timings and counts only (no topic text) for checking on a phone.
  console.log(
    `[research] ${queries.length} searches (${planned.length ? 'model' : 'rules'}), ${found.length} results, ${pagesRead}/${pages.length} pages read, ${picked.length} cited; plan ${timings.planMs} ms, search ${timings.searchMs} ms, read ${timings.readMs} ms, write ${timings.writeMs} ms, total ${Date.now() - t0} ms`,
  );
  return { text, web, queries, ms: Date.now() - t0, timings, pagesRead };
}

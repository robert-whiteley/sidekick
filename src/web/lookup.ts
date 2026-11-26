import { getNetworkStateAsync } from 'expo-network';

import { askLlmAside, cancelLlm, ensureLlm, undoLastTurn } from '@/engine/llm';
import { getSettings } from '@/engine/settings';
import { listSpeakers } from '@/memory/store';
import {
  buildQuery,
  cleanModelQuery,
  decideLookup,
  duckDuckGoUrl,
  LOOKUP_FAILED_NOTE,
  LOOKUP_HINT,
  LOOKUP_TIMEOUT_MS,
  NEWS_TIMEOUT_MS,
  searchTopic,
  withoutLookupTail,
  mergeSources,
  MAX_SOURCES,
  mightBeLookup,
  MODEL_QUERY_BUDGET_MS,
  MODEL_QUERY_MAX_TOKENS,
  modelQueryPrompt,
  normaliseSearxUrl,
  parseDuckDuckGo,
  parseSearx,
  parseWikipedia,
  requestsLookup,
  searxUrl,
  USER_AGENT,
  webContext,
  type WebSource,
  wikipediaUrl,
} from './lookup-logic';
import {
  currentEventsUrl,
  feedSources,
  gdeltUrl,
  interleave,
  isNewsQuestion,
  MAX_FEED_BYTES,
  MAX_FEEDS,
  normaliseFeedUrl,
  parseCurrentEvents,
  parseFeed,
  parseGdelt,
  topicWords,
} from './news-logic';

export type { WebSource };

/** Requests that got an answer from a server / that never reached one (network error, timeout). */
const net = { reached: 0, failed: 0 };

/** GET JSON with a timeout; any failure is null (the answer then stays offline). */
export async function fetchJson(
  url: string,
  timeoutMs = LOOKUP_TIMEOUT_MS,
  doFetch: typeof fetch = fetch,
): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      signal: ctl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        'Api-User-Agent': USER_AGENT,
      },
      credentials: 'omit',
    }).catch((e: unknown) => {
      net.failed++;
      throw e;
    });
    net.reached++;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET a feed's text with a timeout; null on any failure, a non-https final address (after
 * redirects) or a body over MAX_FEED_BYTES.
 */
export async function fetchText(
  url: string,
  timeoutMs = LOOKUP_TIMEOUT_MS,
  doFetch: typeof fetch = fetch,
): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      signal: ctl.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
        'User-Agent': USER_AGENT,
      },
      credentials: 'omit',
    }).catch((e: unknown) => {
      net.failed++;
      throw e;
    });
    net.reached++;
    if (!res.ok || (res.url && !res.url.startsWith('https://'))) return null;
    if (Number(res.headers?.get?.('content-length') ?? 0) > MAX_FEED_BYTES) return null;
    const text = await res.text();
    return text.length > MAX_FEED_BYTES ? null : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type SearchOptions = {
  /** The user's SearXNG address ('' = none). */
  searx: string;
  /** A news question: add GDELT, Wikipedia current events and the user's feeds. */
  news: boolean;
  /** The user's RSS/Atom feeds (https only). */
  feeds: string[];
  now: Date;
};

export type Getters = {
  json: (url: string, timeoutMs?: number) => Promise<unknown>;
  text: (url: string) => Promise<string | null>;
};

const defaultGetters: Getters = {
  json: (u, t) => fetchJson(u, t),
  text: (u) => fetchText(u),
};

/**
 * Wikipedia + DuckDuckGo Instant Answers (+ the user's SearXNG, if set), all at once. For news
 * questions also GDELT headlines, Wikipedia's current events and the user's feeds, in parallel.
 * A news question with no topic ("what's the news today?") skips the encyclopedia sources.
 */
export async function searchWeb(
  query: string,
  opts: SearchOptions,
  get: Getters = defaultGetters,
): Promise<WebSource[]> {
  const base = normaliseSearxUrl(opts.searx);
  const words = opts.news ? topicWords(query) : [];
  const general = !opts.news || words.length > 0;
  const gdelt = opts.news ? gdeltUrl(query) : null;
  const feeds = opts.news
    ? [...new Set(opts.feeds.map(normaliseFeedUrl).filter((u): u is string => !!u))].slice(
        0,
        MAX_FEEDS,
      )
    : [];
  const [wiki, ddg, sx, gd, events, feedItems] = await Promise.all([
    general
      ? get
          .json(wikipediaUrl(query))
          .then(parseWikipedia)
          .catch(() => null)
      : null,
    general
      ? get
          .json(duckDuckGoUrl(query))
          .then(parseDuckDuckGo)
          .catch(() => null)
      : null,
    base && general
      ? get
          .json(searxUrl(base, query))
          .then((j) => parseSearx(j))
          .catch(() => [])
      : [],
    gdelt
      ? get
          .json(gdelt, NEWS_TIMEOUT_MS)
          .then(parseGdelt)
          .catch(() => [])
      : [],
    opts.news
      ? get
          .json(currentEventsUrl(opts.now))
          .then((j) => parseCurrentEvents(j, words))
          .catch(() => [])
      : [],
    Promise.all(
      feeds.map((f) =>
        get
          .text(f)
          .then((x) => (x ? parseFeed(x, f) : []))
          .catch(() => []),
      ),
    ).then((lists) => feedSources(lists.flat(), words)),
  ]);
  if (!opts.news) return mergeSources([wiki, ddg, sx]);
  const news = interleave([events, gd.slice(0, 2), feedItems]);
  return mergeSources([news, wiki, ddg, sx], MAX_SOURCES + 2);
}

/**
 * Gemma's search words for [question] within [budgetMs], or null (then the rules are used).
 * Past the budget the side task is cancelled and waited for (briefly), so the answer that follows
 * has the model to itself.
 */
export async function queryFromModel(
  question: string,
  knownNames: string[],
  write: (prompt: string) => Promise<string>,
  cancel: () => void,
  budgetMs = MODEL_QUERY_BUDGET_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gen = write(modelQueryPrompt(question)).then(
    (t) => ({ t }),
    () => null,
  );
  const late = new Promise<'late'>((res) => {
    timer = setTimeout(() => res('late'), budgetMs);
  });
  const r = await Promise.race([gen, late]);
  clearTimeout(timer);
  if (r === 'late') {
    cancel();
    await Promise.race([gen, new Promise((res) => setTimeout(res, 1000))]);
    return null;
  }
  return r ? cleanModelQuery(r.t, knownNames) : null;
}

const writeAside = (prompt: string) => askLlmAside(prompt, MODEL_QUERY_MAX_TOKENS);

/**
 * The words for the "Search the web in your browser" link, worked out when it is tapped: Gemma's
 * query if the model is loaded and idle (≤1.5 s), else the rule-based one. Names are taken out
 * either way.
 */
export async function browserSearchQuery(question: string): Promise<string> {
  const names = await knownNames();
  const fromModel = await queryFromModel(question, names, writeAside, cancelLlm).catch(() => null);
  return fromModel ?? buildQuery(question, names);
}

export async function isOnline(): Promise<boolean> {
  try {
    const s = await getNetworkStateAsync();
    return s.isConnected !== false && s.isInternetReachable !== false;
  } catch {
    return false;
  }
}

type Asked = { text: string; stats: { totalMs: number; ttftMs: number } };

export type LookupDeps = {
  enabled: () => boolean;
  searxUrl: () => string;
  feeds: () => string[];
  knownNames: () => Promise<string[]>;
  online: () => Promise<boolean>;
  search: (query: string, opts: SearchOptions) => Promise<WebSource[]>;
  /**
   * The last search reached no server at all: Android said online but Sidekick's requests can't
   * get out (a firewall or VPN app, Data Saver, a dead Wi-Fi). Treated like being offline.
   */
  unreachable?: () => boolean;
  /** Gemma's search words (names already stripped), or null to use the rule-based query. */
  writeQuery: (question: string, names: string[]) => Promise<string | null>;
  /** Drops the model's last chat turn (its "LOOKUP" reply) so follow-ups never see it. */
  undoLast: () => void;
  now: () => Date;
};

async function knownNames(): Promise<string[]> {
  return (await listSpeakers().catch(() => []))
    .flatMap((s) => [s.name, s.suggestedName])
    .filter((n): n is string => !!n);
}

let lastUnreachable = false;

const defaultDeps: LookupDeps = {
  enabled: () => getSettings().webLookup,
  searxUrl: () => getSettings().searxngUrl,
  feeds: () => getSettings().newsFeeds,
  knownNames,
  online: isOnline,
  search: async (query, opts) => {
    const before = { ...net };
    const found = await searchWeb(query, opts);
    lastUnreachable = !found.length && net.reached === before.reached && net.failed > before.failed;
    return found;
  },
  unreachable: () => lastUnreachable,
  // Loading the model isn't counted in the budget: the answer needs it next anyway.
  writeQuery: async (question, names) => {
    await ensureLlm();
    return queryFromModel(question, names, writeAside, cancelLlm);
  },
  undoLast: () => {
    undoLastTurn();
  },
  now: () => new Date(),
};

/**
 * Asks the model, looking things up online first when the rules say so, or when Gemma replies
 * LOOKUP. `build` makes the full prompt around the web part. Only search words go online: Gemma's
 * short query for the question (in a throwaway chat that sees nothing else), or the rule-based one,
 * with known names taken out of both. Any lookup failure falls back to the offline answer.
 * `webQuery` is the query used, if a lookup ran (for the browser link).
 */
export async function askWithLookup<T extends Asked>(
  question: string,
  photo: boolean,
  build: (webPart: string) => string,
  /** undoable: the turn may be dropped from the chat afterwards (see LookupDeps.undoLast). */
  ask: (
    prompt: string,
    onText: (full: string) => void,
    opts?: { undoable?: boolean },
  ) => Promise<T>,
  onText: (full: string) => void,
  deps: LookupDeps = defaultDeps,
  /** The earlier question in a spoken conversation, so a follow-up's search keeps its topic. */
  previous?: string,
  /** Progress lines as they happen ("Looking it up online…"). */
  onStatus?: (line: string) => void,
  /** force: look it up whatever the rules say (a question kept until back online). */
  opts: { force?: boolean } = {},
): Promise<T & { web: WebSource[]; webQuery?: string; offline?: boolean }> {
  const enabled = deps.enabled();
  if (!enabled || photo) return { ...(await ask(build(''), onText)), web: [] };
  const names = await deps.knownNames().catch(() => [] as string[]);
  const decision = opts.force
    ? 'lookup'
    : decideLookup(question, { enabled, photo, knownNames: names });
  if (decision === 'none') return { ...(await ask(build(''), onText)), web: [] };

  let webQuery: string | undefined;
  /** A lookup was wanted but there was no internet (the question can wait for it). */
  let offline = false;
  const lookup = async (): Promise<WebSource[]> => {
    if (!(await deps.online())) {
      offline = true;
      return [];
    }
    onStatus?.('Looking it up online…');
    const t0 = Date.now();
    const topic = searchTopic(question, previous);
    const fromModel = await deps.writeQuery(topic, names).catch(() => null);
    const q = fromModel ?? buildQuery(topic, names);
    if (!q) return [];
    webQuery = q;
    const tWords = Date.now() - t0;
    const opts: SearchOptions = {
      searx: deps.searxUrl(),
      news: isNewsQuestion(question),
      feeds: deps.feeds(),
      now: deps.now(),
    };
    const found = await deps.search(q, opts).catch(() => [] as WebSource[]);
    if (!found.length && deps.unreachable?.()) offline = true;
    onStatus?.(
      found.length
        ? `Reading ${found.length} ${found.length === 1 ? 'source' : 'sources'}…`
        : 'Nothing found online',
    );
    // Timings only (no question text) for checking budgets on a phone.
    console.log(
      `[lookup] words by ${fromModel ? 'model' : 'rules'} in ${tWords} ms; ${found.length} sources (${[...new Set(found.map((w) => w.name))].join(', ')}) in ${Date.now() - t0 - tWords} ms${opts.news ? ' · news' : ''}`,
    );
    return found;
  };

  if (decision === 'lookup') {
    const web = await lookup();
    return { ...(await ask(build(webContext(web, deps.now())), onText)), web, webQuery, offline };
  }

  // 'ask-model': hold the streamed text back while it could still be "LOOKUP".
  let shown = false;
  let lastShown = '';
  const first = await ask(
    build(LOOKUP_HINT),
    (full) => {
      if (!shown && mightBeLookup(full)) return;
      const visible = withoutLookupTail(full);
      if (!visible) return;
      shown = true;
      lastShown = visible;
      onText(visible);
    },
    { undoable: true },
  );
  if (!requestsLookup(first.text)) {
    if (!shown && first.text) onText(first.text);
    else if (first.text !== lastShown) onText(first.text); // a held-back "L…" was a word
    return { ...first, web: [] };
  }
  // The hidden "LOOKUP" turn leaves the chat: a spoken follow-up sees only question and answer.
  deps.undoLast();
  const web = await lookup();
  const second = await ask(
    build(web.length ? webContext(web, deps.now()) : LOOKUP_FAILED_NOTE),
    onText,
  );
  return {
    ...second,
    stats: {
      ...second.stats,
      totalMs: first.stats.totalMs + second.stats.totalMs,
      ttftMs: first.stats.totalMs + second.stats.ttftMs,
    },
    web,
    webQuery,
    offline,
  };
}

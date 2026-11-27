/**
 * Research (lite), pure parts: the model plans a few searches, the phone reads the pages they
 * find, keeps only the passages that match, and the model writes a short report with numbered
 * sources. Only search words (names taken out) and the result pages' addresses leave the phone.
 *
 * Built for a CPU-only phone: one short planning pass and one report pass, nothing per page. The
 * page reading (choosing what goes in the prompt) is plain code, so 6 pages cost seconds, not a
 * model pass each. Tested in __tests__/research-test.ts.
 */
import { cleanModelQuery, clipText, stripNames, type WebSource } from './lookup-logic';

/** At most this many searches per research request (each runs every enabled source). */
export const MAX_QUERIES = 4;
/** Pages fetched and read in full (Wikipedia articles through its API, other pages as HTML). */
export const MAX_PAGES = 6;
/** Sources quoted in the report prompt. */
export const MAX_REPORT_SOURCES = 6;
/**
 * Wikimedia requests one research search makes (Wikipedia's top hit and a full-text search). Each
 * phone stays under Wikimedia's 10 a minute (rate-limit.ts), so the plan is trimmed to fit.
 */
export const WIKI_PER_SEARCH = 2;
/** Wikipedia articles left room for when the plan is trimmed to the Wikimedia budget. */
export const MIN_WIKI_READS = 3;

/** How many of [n] planned searches fit with [wikiLeft] Wikimedia requests left (at least 1). */
export function searchesWithin(n: number, wikiLeft: number): number {
  return Math.max(1, Math.min(n, Math.floor((wikiLeft - MIN_WIKI_READS) / WIKI_PER_SEARCH)));
}

/**
 * The pages to read, in [order], at most [max]: Wikipedia pages only while the budget lasts,
 * other sites in their place (they aren't limited).
 */
export function chooseReads<T>(
  order: T[],
  max: number,
  wikiLeft: number,
  isWiki: (x: T) => boolean,
): T[] {
  const out: T[] = [];
  let left = wikiLeft;
  for (const x of order) {
    if (out.length >= max) break;
    if (isWiki(x)) {
      if (left <= 0) continue;
      left--;
    }
    out.push(x);
  }
  return out;
}

/**
 * Characters of source text in the report prompt (~1,100 tokens). On the Pixel 5 every prompt
 * token is read before the first word, and the model's window is 4,096 tokens for prompt + answer.
 */
export const REPORT_SOURCE_CHARS = 4400;
/** Each quoted passage. */
export const PASSAGE_CHARS = 420;
export const PAGE_TIMEOUT_MS = 6000;
export const MAX_PAGE_BYTES = 1_500_000;
export const PLAN_MAX_TOKENS = 90;
export const REPORT_MAX_TOKENS = 420;

export function planPrompt(topic: string, now: Date): string {
  return (
    `Today is ${now.toISOString().slice(0, 10)}. Plan web research on the request below. Write ` +
    `${MAX_QUERIES - 1} or ${MAX_QUERIES} different short web search queries (at most 6 words ` +
    'each) that together cover what is needed: the main topic first, then the parts it asks ' +
    'about. Use plain keywords that an encyclopedia or news search would match. Reply with JSON ' +
    `only: {"queries":["...","..."]}\nRequest: ${topic.trim()}`
  );
}

/**
 * The model's plan → search words: each query cleaned (no quotes or labels, names out, ≤8
 * words), duplicates dropped, at most MAX_QUERIES. Accepts JSON, a JSON list or one per line.
 * Empty when nothing usable is left (the caller then searches the request's own words).
 */
export function parsePlan(reply: string, knownNames: string[]): string[] {
  let raw: unknown[] = [];
  const json = /[[{][\s\S]*[\]}]/.exec(reply.replace(/```(?:json)?/g, ''))?.[0];
  if (json) {
    try {
      const o = JSON.parse(json) as unknown;
      raw = Array.isArray(o)
        ? o
        : o && typeof o === 'object'
          ? (((o as Record<string, unknown>).queries ??
              (o as Record<string, unknown>).searches ??
              []) as unknown[])
          : [];
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw) || !raw.length) {
    // One query per line; a single line of prose ("no idea") is not a plan.
    const lines = reply
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter((l) => l && !/^[{}[\]]/.test(l) && !l.endsWith(':') && l.split(/\s+/).length <= 10);
    raw = lines.length >= 2 ? lines : [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== 'string') continue;
    const q = cleanModelQuery(r, knownNames);
    if (!q) continue;
    const key = q.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_QUERIES) break;
  }
  return out;
}

/** The request itself as search words, when the model gave no usable plan. */
export function fallbackQueries(topic: string, knownNames: string[]): string[] {
  const q = stripNames(topic, knownNames)
    .replace(
      /^(please\s+)?(can you\s+|could you\s+)?(do (some |a bit of )?(deep )?research (on|into|about)|research|look into|find out (about|everything about)?|write (me )?a (short )?report (on|about)|dig into|investigate)\s+/i,
      '',
    )
    .replace(/[?.!]+$/, '')
    .trim();
  const words = q.split(/\s+/).filter(Boolean).slice(0, 10).join(' ');
  if (words.length < 2) return [];
  // Also the bare keywords: a long sentence often matches nothing in an encyclopedia search.
  const keys = termsOf(q)
    .filter((t, i, all) => !all.includes(`${t}s`))
    .slice(0, 6)
    .join(' ');
  return keys && keys !== words.toLowerCase() ? [words, keys] : [words];
}

/** Wikipedia's own search, several articles per query (the quick lookup takes only the top one). */
export function wikipediaSearchUrl(query: string, limit = 3, lang = 'en'): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    srprop: 'snippet',
  });
  return `https://${lang}.wikipedia.org/w/api.php?${p.toString()}`;
}

export function parseWikipediaSearch(json: unknown, lang = 'en'): WebSource[] {
  const hits = (json as { query?: { search?: { title?: unknown; snippet?: unknown }[] } } | null)
    ?.query?.search;
  if (!Array.isArray(hits)) return [];
  return hits.flatMap((h) => {
    const title = typeof h.title === 'string' ? h.title : '';
    if (!title) return [];
    const snippet = typeof h.snippet === 'string' ? h.snippet : '';
    return [
      {
        name: 'Wikipedia',
        title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        text: clipText(
          decodeEntities(
            snippet
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          ),
        ),
        licence: 'CC BY-SA 4.0',
      },
    ];
  });
}

/** Wikipedia page title from an article URL, or null for any other address. */
export function wikipediaTitle(url: string): { lang: string; title: string } | null {
  const m = /^https:\/\/([a-z-]{2,12})\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/.exec(url);
  if (!m) return null;
  try {
    return { lang: m[1], title: decodeURIComponent(m[2]).replace(/_/g, ' ') };
  } catch {
    return null;
  }
}

/** The whole article as plain text, through the API (no HTML to clean up). */
export function wikipediaArticleUrl(lang: string, title: string): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'extracts',
    explaintext: '1',
    redirects: '1',
    titles: title,
  });
  return `https://${lang}.wikipedia.org/w/api.php?${p.toString()}`;
}

export function parseWikipediaArticle(json: unknown): string {
  const pages = (json as { query?: { pages?: { extract?: unknown }[] } } | null)?.query?.pages;
  const text = Array.isArray(pages) ? pages[0]?.extract : '';
  return typeof text === 'string' ? text : '';
}

/** Only plain https pages are fetched (no local addresses, no credentials in the URL). */
export function fetchablePage(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === 'duckduckgo.com' && (u.pathname === '/' || !u.pathname)) return false;
  return !(
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^(\d+\.){3}\d+$/.test(h) ||
    h.includes(':')
  );
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/**
 * A page's readable text: the paragraphs (and list items, headings) of its main part, without
 * scripts, menus, headers, footers, forms or cookie banners. One paragraph per line. A small
 * reader, not a browser: good enough for articles, which is what search results mostly are.
 */
export function htmlToText(html: string): string {
  let h = html
    .slice(0, MAX_PAGE_BYTES)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|svg|template|iframe|head|nav|header|footer|aside|form|button|select|figure)\b[\s\S]*?<\/\1\s*>/gi,
      ' ',
    );
  // The article or main element, when there is one, holds the text worth reading.
  const main =
    /<article\b[\s\S]*?<\/article\s*>/i.exec(h)?.[0] ?? /<main\b[\s\S]*?<\/main\s*>/i.exec(h)?.[0];
  if (main && main.length > 500) h = main;
  const blocks: string[] = [];
  const re = /<(p|li|h[1-4]|blockquote|dd|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  for (let m = re.exec(h); m; m = re.exec(h)) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const heading = /^h/i.test(m[1]);
    // Menus, bylines, share buttons and cookie lines are short; headings are kept as context.
    if (!heading && text.length < 40) continue;
    if (
      /\b(cookies?|subscribe|sign up|newsletter|javascript|advertisement)\b/i.test(text) &&
      text.length < 200
    )
      continue;
    blocks.push(heading ? `## ${text}` : text);
  }
  return blocks.join('\n');
}

/** Wikipedia's plain text minus the sections that are only lists of links. */
export function cleanArticle(text: string): string {
  const cut =
    /\n={2,}\s*(See also|References|Notes|Further reading|External links|Sources|Bibliography|Citations)\s*={2,}[\s\S]*$/i;
  return text
    .replace(cut, '')
    .replace(/^\s*={2,}\s*(.+?)\s*={2,}\s*$/gm, '## $1')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Paragraph-sized pieces (~PASSAGE_CHARS), each tagged with the heading it sits under. */
export function passagesOf(text: string, max = PASSAGE_CHARS): string[] {
  const out: string[] = [];
  let heading = '';
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    if (l.startsWith('## ')) {
      heading = l.slice(3);
      continue;
    }
    const sentences = l.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [l];
    let cur = '';
    for (const s of sentences) {
      if (cur && cur.length + s.length > max) {
        out.push(tag(heading, cur));
        cur = '';
      }
      cur += s;
    }
    if (cur.trim().length >= 40) out.push(tag(heading, cur));
  }
  return out;
}

const tag = (heading: string, text: string) =>
  `${heading ? `(${heading}) ` : ''}${clipText(text.trim(), PASSAGE_CHARS)}`;

const STOP = new Set(
  'the and are was were what when where which who why how you your for with that this did does have has from about into than then them they their there these those its can could would should will more most much many some any also not but all out over under after before between research report find look tell give write short deep compare comparison versus best good bad pros cons'.split(
    ' ',
  ),
);

/** Topic words: lower-case, 3+ letters, common words out; a plural also matches its singular. */
export function termsOf(text: string): string[] {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w);
    if (w.length > 4 && w.endsWith('s')) out.add(w.slice(0, -1));
  }
  return [...out];
}

function score(passage: string, terms: string[]): number {
  const p = ` ${passage.toLowerCase()} `;
  let s = 0;
  for (const t of terms) {
    if (p.includes(t)) s += 1 + Math.min(2, (p.split(t).length - 2) * 0.25);
  }
  // Numbers and dates are often the facts a report needs.
  if (/\d/.test(passage)) s += 0.3;
  return s;
}

/** Share of the request's words a page must contain (title + best passages) to be quoted. */
export const MIN_RELEVANCE = 0.5;

/** Share of [terms] (plurals folded into their singular) found in [text]. */
export function relevance(text: string, terms: string[]): number {
  const base = terms.filter((t) => !(t.endsWith('s') && terms.includes(t.slice(0, -1))));
  if (!base.length) return 1;
  const t = text.toLowerCase();
  return base.filter((w) => t.includes(w)).length / base.length;
}

export type ReadPage = {
  source: WebSource;
  /** The search words that found it. */
  query: string;
  /** The page's full readable text ('' when it couldn't be fetched: the snippet is used). */
  text: string;
};

export type Picked = { source: WebSource; passages: string[] };

/**
 * What goes in the report prompt: from each page, the passages that best match the request and
 * the search that found it, within REPORT_SOURCE_CHARS. Each source gets its best passage first
 * (so every source can be cited), then the rest of the room goes to the best passages overall.
 * A page that couldn't be fetched keeps its search snippet.
 */
export function pickPassages(
  pages: ReadPage[],
  topic: string,
  budget = REPORT_SOURCE_CHARS,
): Picked[] {
  const topicTerms = termsOf(topic);
  const all = pages.map((p, order) => {
    const terms = [...new Set([...topicTerms, ...termsOf(p.query)])];
    const pieces = p.text ? passagesOf(p.text) : [];
    // The opening of an article is its summary: a small head start.
    const scored = pieces
      .map((text, i) => {
        const s = score(text, terms);
        return { text, s: s > 0 ? s + (i === 0 ? 0.8 : i < 3 ? 0.3 : 0) : 0 };
      })
      .filter((x) => x.s > 0.5)
      .sort((a, b) => b.s - a.s);
    if (!scored.length && p.source.text) scored.push({ text: p.source.text, s: 0.1 });
    const head = scored
      .slice(0, 3)
      .map((x) => x.text)
      .join(' ');
    return {
      source: p.source,
      scored,
      rel: relevance(`${p.source.title} ${head}`, topicTerms),
      order,
    };
  });
  // Off-topic pages (a full-text search for "heat pumps in older houses" also finds "Breast
  // pump"): kept only if they cover enough of the request's words, best first; at least two stay.
  const usable = all.filter((r) => r.scored.length);
  const enough = usable.filter((r) => r.rel >= MIN_RELEVANCE);
  const ranked = (
    enough.length >= 2 ? enough : [...usable].sort((a, b) => b.rel - a.rel).slice(0, 2)
  )
    .sort((a, b) => b.rel - a.rel || a.order - b.order)
    .slice(0, MAX_REPORT_SOURCES);
  const picked: Picked[] = ranked.map((r) => ({ source: r.source, passages: [] }));
  let used = 0;
  // Round 1: every source's best passage.
  ranked.forEach((r, i) => {
    const best = r.scored[0];
    if (best && used + best.text.length <= budget) {
      picked[i].passages.push(best.text);
      used += best.text.length;
    }
  });
  // Then the best remaining passages, whichever page they are on (at most 3 per page).
  const rest = ranked
    .flatMap((r, i) => r.scored.slice(1, 3).map((x) => ({ ...x, i })))
    .sort((a, b) => b.s - a.s);
  for (const x of rest) {
    if (used + x.text.length > budget) continue;
    picked[x.i].passages.push(x.text);
    used += x.text.length;
  }
  return picked.filter((p) => p.passages.length);
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export function reportPrompt(topic: string, picked: Picked[], now: Date): string {
  const blocks = picked
    .map((p, i) => {
      const where = [p.source.domain || host(p.source.url), p.source.date]
        .filter(Boolean)
        .join(', ');
      return `[${i + 1}] ${p.source.title}${where ? ` (${where})` : ''}\n${p.passages.join('\n')}`;
    })
    .join('\n\n');
  return (
    `Today is ${now.toISOString().slice(0, 10)}. Sources found online (may be incomplete or out ` +
    `of date):\n\n${blocks}\n\nWrite a short research report for this request: ${topic.trim()}\n` +
    'Use only the sources above. Start with one or two sentences that answer the request. Then ' +
    '3 to 5 bullet points starting with "- ", each with the key facts and ending with its ' +
    'source numbers in brackets, like [2]. If the sources disagree or leave something out, ' +
    'say so in one last line. At most 200 words. No title.'
  );
}

/** The picked sources, numbered as in the report (shown as links under it). */
export function reportSources(picked: Picked[]): WebSource[] {
  return picked.map((p, i) => ({ ...p.source, ref: i + 1 }));
}

/**
 * The report as shown: citations that point past the source list are taken out (the small
 * model sometimes invents a [7]); everything else as written.
 */
export function cleanReport(text: string, sourceCount: number): string {
  return text
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (all, nums: string) => {
      const ok = nums
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => n >= 1 && n <= sourceCount);
      return ok.length ? `[${ok.join(', ')}]` : '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Progress lines, as each step starts. */
export const progress = {
  planning: 'Planning the research…',
  waiting: (s: number) => `Waiting ${s} s for Wikipedia's per-minute limit…`,
  searching: (i: number, n: number, q: string) => `Searching ${i} of ${n}: ${q}…`,
  reading: (i: number, n: number, site: string) => `Reading ${i} of ${n}: ${site}…`,
  writing: (n: number) => `Writing the report from ${n} ${n === 1 ? 'source' : 'sources'}…`,
};

export const siteName = (s: WebSource) => s.domain || host(s.url) || s.name;

export const RESEARCH_OFFLINE =
  'Research needs Online on (tap Offline above the chat). Only search words and the pages ' +
  'found are fetched; nothing about you is sent.';
export const RESEARCH_NO_INTERNET = "There's no internet right now, so I can't research that.";
export const RESEARCH_NOTHING = "I couldn't find anything online for that. Try other words.";

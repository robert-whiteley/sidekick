/**
 * Online lookup, pure parts: when to look something up, what to send, and how to read the replies.
 * Only the user's question text is ever sent (with known people's names taken out); never memory,
 * photos, location or anything else. See PRIVACY.md and docs/decisions/0005-mvp-choices.md.
 */

/** A short piece of outside text put in the prompt, and shown as a link under the answer. */
export type WebSource = {
  /** "Wikipedia", "DuckDuckGo", or the SearXNG result's site. */
  name: string;
  title: string;
  url: string;
  text: string;
  /** Licence note shown with the link (Wikipedia text is CC BY-SA 4.0). */
  licence?: string;
  /** News items: the publisher's site and the day (YYYY-MM-DD). */
  domain?: string;
  date?: string;
  /** A research report's source number ("[2]" in the text). */
  ref?: number;
};

export const LOOKUP_TIMEOUT_MS = 4000;
/**
 * GDELT gets the normal limit: in Nov 2026 tests (UK) it took 9–11 s and then only replied 429
 * "busy" on every try, so waiting longer added ~5 s to each news question for nothing.
 */
export const NEWS_TIMEOUT_MS = LOOKUP_TIMEOUT_MS;
/**
 * Names the app only: no URL, email or username, so nothing points at a person. Wikimedia counts
 * such a client as unidentified (10 requests a minute per IP, 2026 limits); every Wikimedia
 * request goes through one per-minute window that keeps under that (rate-limit.ts).
 */
export const USER_AGENT = 'SidekickApp/1.0 (on-device assistant app)';
/** Each source's text in the prompt; every prompt token delays the first word on a phone. */
export const SOURCE_CHARS = 360;
export const MAX_SOURCES = 3;
const QUERY_CHARS = 120;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Takes known people's names (and their possessive) out of the text sent online. */
export function stripNames(text: string, names: string[]): string {
  let out = text;
  for (const n of names.map((x) => x.trim()).filter((x) => x.length > 1)) {
    out = out.replace(new RegExp(`\\b${escapeRe(n)}('s|s')?(?!\\w)`, 'gi'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

const LEAD =
  /^(hey sidekick,?\s*|please\s+|can you\s+|could you\s+|would you\s+|quickly\s+|(look up|search (the )?(web|internet|online) for|search for|google|find out|tell me about|tell me|define)\s+)+/i;
const QUESTION_WORDS =
  /^(who|what|when|where|which|why|how)('s| (is|are|was|were|did|does|do|has|have|many|much|old|tall|big|far|long|deep|high|large))*\s+/i;
const TRAIL =
  /\s*(\bon (wikipedia|the (web|internet))|\bonline|\bplease|\bfor me|\bnow)?\s*[?.!]*\s*$/i;

/**
 * The search words: the question with names stripped, polite/question lead-ins and the trailing
 * "online?" removed. Falls back to the stripped question when nothing would be left.
 */
export function buildQuery(question: string, knownNames: string[]): string {
  const stripped = stripNames(question, knownNames);
  let q = stripped;
  for (let i = 0; i < 3; i++) q = q.replace(LEAD, '').replace(TRAIL, '').trim();
  q = q.replace(QUESTION_WORDS, '').replace(/^(the|a|an)\s+/i, '');
  q = q.replace(TRAIL, '').trim();
  if (q.length < 2) q = stripped.replace(/[?.!]+$/, '').trim();
  return q.slice(0, QUERY_CHARS);
}

export function wikipediaUrl(query: string, lang = 'en'): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '1',
    prop: 'extracts|info',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    inprop: 'url',
    redirects: '1',
  });
  return `https://${lang}.wikipedia.org/w/api.php?${p.toString()}`;
}

export function duckDuckGoUrl(query: string): string {
  const p = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
    t: 'sidekickapp',
  });
  return `https://api.duckduckgo.com/?${p.toString()}`;
}

/** A user-given SearXNG base URL, normalised; null when it isn't a plain https URL. */
export function normaliseSearxUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  return `${u.origin}${u.pathname.replace(/\/(search)?\/?$/, '')}`;
}

export function searxUrl(base: string, query: string): string {
  return `${base}/search?${new URLSearchParams({ q: query, format: 'json', safesearch: '1' })}`;
}

export function clipText(text: string, max = SOURCE_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return end >= max * 0.4 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

const WIKI_LICENCE = 'CC BY-SA 4.0';
const str = (v: unknown) => (typeof v === 'string' ? v : '');
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

export function parseWikipedia(json: unknown): WebSource | null {
  const pages = obj(obj(json).query).pages;
  if (!Array.isArray(pages) || !pages.length) return null;
  const page = [...pages].map(obj).sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))[0];
  const text = clipText(str(page.extract));
  const title = str(page.title);
  if (!text || !title) return null;
  const url = str(page.fullurl) || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
  return { name: 'Wikipedia', title, url, text, licence: WIKI_LICENCE };
}

export function parseDuckDuckGo(json: unknown): WebSource | null {
  const j = obj(json);
  const answer = str(j.Answer);
  if (answer) {
    return {
      name: 'DuckDuckGo',
      title: str(j.Heading) || 'Answer',
      url: 'https://duckduckgo.com/',
      text: clipText(answer),
    };
  }
  const abstract = str(j.AbstractText) || str(j.Definition);
  if (!abstract) return null;
  const via = str(j.AbstractSource) || str(j.DefinitionSource);
  return {
    name: via ? `DuckDuckGo / ${via}` : 'DuckDuckGo',
    title: str(j.Heading) || via || 'DuckDuckGo',
    url: str(j.AbstractURL) || str(j.DefinitionURL) || 'https://duckduckgo.com/',
    text: clipText(abstract),
    licence: /wikipedia/i.test(via) ? WIKI_LICENCE : undefined,
  };
}

export function parseSearx(json: unknown, max = 2): WebSource[] {
  const j = obj(json);
  const out: WebSource[] = [];
  const answers = Array.isArray(j.answers) ? j.answers : [];
  for (const a of answers) {
    const text = typeof a === 'string' ? a : str(obj(a).answer);
    if (text)
      out.push({ name: 'SearXNG', title: 'Answer', url: str(obj(a).url), text: clipText(text) });
  }
  const results = Array.isArray(j.results) ? j.results.map(obj) : [];
  for (const r of results) {
    const url = str(r.url);
    const text = str(r.content);
    if (!/^https?:\/\//.test(url) || !text) continue;
    let host = 'web';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {}
    out.push({ name: host, title: str(r.title) || host, url, text: clipText(text, 240) });
  }
  return out.slice(0, max);
}

/** Wikipedia first; a DuckDuckGo copy of the same Wikipedia page is dropped. */
export function mergeSources(
  lists: (WebSource | WebSource[] | null)[],
  max = MAX_SOURCES,
): WebSource[] {
  const all = lists.flatMap((x) => (x ? (Array.isArray(x) ? x : [x]) : []));
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const s of all) {
    const key = s.url.replace(/^https?:\/\/(\w+\.)?(m\.)?/, '').toLowerCase();
    if (s.url && seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, max);
}

/** The prompt part, before the memory notes. */
export function webContext(sources: WebSource[], today: Date): string {
  if (!sources.length) return '';
  const lines = sources
    .map((s) =>
      s.date || s.domain
        ? `- [${[s.name, s.domain, s.date].filter(Boolean).join(', ')}] ${s.text}`
        : `- [${s.name}: ${s.title}] ${s.text}`,
    )
    .join('\n');
  return (
    `Today is ${today.toISOString().slice(0, 10)}. From an online lookup (may be incomplete or ` +
    `out of date; say which source you used):\n${lines}\n`
  );
}

export const LOOKUP_FAILED_NOTE =
  'The online lookup found nothing; answer from what you know and say you could not check.\n';

/** Gemma writes the search words; a fresh, memory-free chat sees only this and the question. */
export const MODEL_QUERY_BUDGET_MS = 1500;
export const MODEL_QUERY_MAX_TOKENS = 24;
const MODEL_QUERY_WORDS = 8;

export function modelQueryPrompt(question: string, previous?: string): string {
  const p = previous?.trim();
  return (
    'Write a short web search query (at most 8 words) for the question below. Reply with only ' +
    'the query: no quotes, no explanation.\n' +
    (p ? `Earlier question (use it only if this one refers to it): ${p}\n` : '') +
    `Question: ${question.trim()}`
  );
}

/**
 * Gemma's reply as search words: first line, no quotes, labels or markdown, known names taken
 * out, at most 8 words. Null when nothing usable is left (then the rule-based query is used).
 */
export function cleanModelQuery(text: string, knownNames: string[]): string | null {
  const line =
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  if (!line || /\b(sorry|i can(no|')t|as an ai)\b/i.test(line)) return null;
  const words = stripNames(
    line
      .replace(/^(search( query)?|query|keywords?)\s*:\s*/i, '')
      .replace(/[`*_#"“”‘’<>]|^'|'$/g, ' ')
      .replace(/[?.!,;:]+$/g, ''),
    knownNames,
  )
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MODEL_QUERY_WORDS);
  const q = words.join(' ').replace(/[?.!,;:]+$/g, '');
  return q.length >= 2 ? q.slice(0, QUERY_CHARS) : null;
}

/**
 * Online lookup off and the model answered from what it knows: did that answer give what was
 * asked? The model decides in a short throwaway check; only a factual question it could not
 * answer gets the "Search the web in your browser" link (never a joke, a recipe or the user's
 * own life, where a web search wouldn't help).
 */
export const WEB_OFFER_SYSTEM =
  'You check an answer from an offline assistant. Reply with one word only: WEB if the answer ' +
  'does not give what was asked because it needs facts the assistant does not have, and a web ' +
  "search could find them; NO if it answers, or if the question is about the user's own life, " +
  'notes or phone, or a web search would not help.';

export const WEB_OFFER_MAX_TOKENS = 3;

export function webOfferPrompt(question: string, answer: string): string {
  return `Question: ${question.trim().slice(0, 400)}\nAnswer: ${answer.trim().slice(0, 600)}\n\nWEB or NO:`;
}

/** The check's reply: WEB (any case, possibly with punctuation) offers the link. */
export const wantsWebOffer = (reply: string) => /^\W*WEB\b/i.test(reply.trim());

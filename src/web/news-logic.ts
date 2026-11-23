/**
 * News lookup, pure parts: GDELT DOC 2.0 headlines, Wikipedia "Portal:Current events" and the
 * user's own RSS/Atom feeds. Only the search words go to GDELT; Wikipedia and feeds get no
 * question at all (the whole day's page or feed is fetched and matched on the phone).
 */
import { clipText, type WebSource } from './lookup-logic';

/** "latest / news / today / recent / what happened" style questions. */
const NEWS =
  /\b(latest|news|headlines?|today|today's|recent(ly)?|what('s| has| is)? happen(ed|ing)|this (week|morning)|breaking|current events)\b/i;
/** News words that say "news" but aren't the topic. */
const NEWS_WORDS =
  /\b(the |any )?(latest|news|headlines?|today|today's|recent(ly)?|current events|breaking|this (week|morning)|what('s| has| is)? happen(ed|ing)|update(s)?|so far|right now|now)\b/gi;
const STOP = new Set(
  (
    'a an the and or of in on at to for with about from by is are was were be been what whats ' +
    'who which when where why how any some there has have had did does do in into over its it ' +
    'this that these those news latest today'
  ).split(' '),
);

export const NEWS_PER_SOURCE = 2;
export const MAX_NEWS = 4;
/** Every prompt line costs time; a headline needs little. */
const HEADLINE_CHARS = 200;
/** Feeds bigger than this are skipped (keeps parsing fast and memory small). */
export const MAX_FEED_BYTES = 1_000_000;
export const MAX_FEEDS = 10;

export function isNewsQuestion(question: string): boolean {
  return NEWS.test(question);
}

/** The topic words of a news query: "latest news on the Nvidia CEO" -> ["nvidia", "ceo"]. */
export function topicWords(query: string): string[] {
  const words = query
    .replace(NEWS_WORDS, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)];
}

const stem = (w: string) => w.toLowerCase().replace(/(ies|es|s|'s)$/, '');

/** How many of the topic words appear in [text] (word starts, plural-tolerant). */
export function matchScore(text: string, words: string[]): number {
  const have = new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .map(stem),
  );
  return words.filter((w) => have.has(stem(w))).length;
}

/**
 * Items about the topic, best match first (ties keep their order, i.e. newest first). With no
 * topic words ("what's the news today?") the first items are kept as they are.
 */
export function pickMatching<T>(
  items: T[],
  words: string[],
  textOf: (t: T) => string,
  max: number,
): T[] {
  if (!words.length) return items.slice(0, max);
  const need = Math.min(2, words.length);
  return items
    .map((item, i) => ({ item, i, score: matchScore(textOf(item), words) }))
    .filter((x) => x.score >= need)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .map((x) => x.item);
}

/** Only plain web links are ever opened (a feed could carry javascript: or intent: links). */
export function safeLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------- GDELT

/** GDELT DOC 2.0 article list, English only, newest first; null when no usable topic words. */
export function gdeltUrl(query: string, max = 8): string | null {
  // GDELT rejects words under 3 letters and punctuation-only terms.
  const words = topicWords(query);
  if (!words.length) return null;
  const p = new URLSearchParams({
    query: `${words.slice(0, 6).join(' ')} sourcelang:english`,
    mode: 'ArtList',
    format: 'json',
    maxrecords: String(max),
    sort: 'DateDesc',
    timespan: '7d',
  });
  return `https://api.gdeltproject.org/api/v2/doc/doc?${p.toString()}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

/** "20261123T101500Z" -> "2026-11-23". */
function gdeltDay(s: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function parseGdelt(json: unknown): WebSource[] {
  const arts = obj(json).articles;
  if (!Array.isArray(arts)) return [];
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const a of arts.map(obj)) {
    const url = safeLink(str(a.url));
    // GDELT titles come tokenised ("insists , despite"); put the punctuation back.
    const title = clipText(str(a.title).replace(/\s+([,.;:!?%])/g, '$1'), HEADLINE_CHARS);
    if (!url || !title) continue;
    const key = normTitle(title);
    if (seen.has(key)) continue; // the same wire story on many sites
    seen.add(key);
    const domain = str(a.domain) || domainOf(url);
    out.push({ name: 'GDELT', title, url, text: title, domain, date: gdeltDay(str(a.seendate)) });
  }
  return out;
}

// ---------------------------------------------------------------- Wikipedia current events

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Portal:Current events/2026 November 23" (UTC day). */
export function currentEventsTitle(d: Date): string {
  return `Portal:Current events/${d.getUTCFullYear()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Today's and yesterday's pages in one request (early in the UTC day, today's page is short or
 * not there yet).
 */
export function currentEventsUrl(now: Date): string {
  const yesterday = new Date(now.getTime() - 86_400_000);
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    titles: `${currentEventsTitle(now)}|${currentEventsTitle(yesterday)}`,
  });
  return `https://en.wikipedia.org/w/api.php?${p.toString()}`;
}

/** Wikitext to plain text: links to their label, no bold/italics, templates or tags. */
function wikiPlain(s: string): string {
  return s
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXT_LINK = /\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]*))?\]/g;

type EventItem = WebSource & { context: string };

function pageDay(title: string): string | undefined {
  const m = /(\d{4}) (\w+) (\d{1,2})$/.exec(title);
  const mi = m ? MONTHS.indexOf(m[2]) : -1;
  if (!m || mi < 0) return undefined;
  return `${m[1]}-${String(mi + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/** Each news line of a day page, with the topic lines above it kept for matching. */
export function parseCurrentEventsPage(title: string, wikitext: string): EventItem[] {
  const date = pageDay(title);
  const out: EventItem[] = [];
  let category = '';
  const topics: string[] = [];
  const body = wikitext.split('<!-- All news items below this line -->').pop() ?? '';
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const heading = /^'''(.+)'''$/.exec(line);
    if (heading) {
      category = wikiPlain(heading[1]);
      topics.length = 0;
      continue;
    }
    const bullet = /^(\*+)\s*(.*)$/.exec(line);
    if (!bullet) continue;
    const depth = bullet[1].length;
    const content = bullet[2];
    const links = [...content.matchAll(EXT_LINK)];
    if (!links.length) {
      topics.length = depth - 1;
      topics[depth - 1] = wikiPlain(content);
      continue;
    }
    const url = links.map((l) => safeLink(l[1])).find((u): u is string => !!u);
    const headline = clipText(wikiPlain(content.replace(EXT_LINK, '')), HEADLINE_CHARS);
    if (!url || !headline) continue;
    const via = wikiPlain((links[0][2] ?? '').replace(/^\(|\)$/g, ''));
    out.push({
      name: 'Wikipedia Current events',
      title: headline,
      url,
      text: headline,
      domain: domainOf(url) || via,
      date,
      licence: 'CC BY-SA 4.0',
      context: [category, ...topics.slice(0, depth - 1)].join(' '),
    });
  }
  return out;
}

/** Matching items from the recorded day pages, newest day first. */
export function parseCurrentEvents(
  json: unknown,
  words: string[],
  max = NEWS_PER_SOURCE,
): WebSource[] {
  const pages = obj(obj(json).query).pages;
  if (!Array.isArray(pages)) return [];
  const items = pages
    .map(obj)
    .filter((p) => !p.missing)
    .map((p) => {
      const rev = obj(Array.isArray(p.revisions) ? p.revisions[0] : null);
      const text = str(obj(obj(rev.slots).main).content) || str(rev.content);
      return parseCurrentEventsPage(str(p.title), text);
    })
    .sort((a, b) => (b[0]?.date ?? '').localeCompare(a[0]?.date ?? ''))
    .flat();
  return pickMatching(items, words, (i) => `${i.title} ${i.context}`, max).map(
    ({ context: _c, ...s }) => s,
  );
}

// ---------------------------------------------------------------- RSS / Atom feeds

/** A user-added feed address, normalised; null unless it is a plain https URL. */
export function normaliseFeedUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export type FeedItem = { title: string; url: string; date?: string; feed: string };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Only the predefined and numeric entities; no DTDs, so nothing can expand. */
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Element text: CDATA kept as-is, markup removed, entities decoded. */
function textOf(inner: string): string {
  const parts = inner.split(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  const joined = parts
    .map((p, i) => (i % 2 ? p : decode(p.replace(/<[^>]*>/g, ' '))))
    .join('')
    // Some feeds escape their HTML (type="html"): decode once more and drop it too.
    .replace(/<[^>]*>/g, ' ');
  return decode(joined)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function field(block: string, tags: string[]): string {
  for (const tag of tags) {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    if (m) {
      const t = textOf(m[1]);
      if (t) return t;
    }
  }
  return '';
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? '') : '';
}

function itemLink(block: string): string {
  // Atom: <link href="…" rel="alternate"/>; RSS: <link>…</link>.
  const tags = block.match(/<link\b[^>]*>/gi) ?? [];
  const alt =
    tags.find((t) => /\bhref\s*=/i.test(t) && /rel\s*=\s*["']alternate["']/i.test(t)) ??
    tags.find((t) => /\bhref\s*=/i.test(t) && !/rel\s*=/i.test(t));
  if (alt) return attr(alt, 'href');
  const rss = field(block, ['link']);
  if (rss) return rss;
  const guid = /<guid\b([^>]*)>([\s\S]*?)<\/guid>/i.exec(block);
  return guid && !/isPermaLink\s*=\s*["']false/i.test(guid[1]) ? textOf(guid[2]) : '';
}

function dayOf(raw: string): string | undefined {
  const t = Date.parse(raw);
  return Number.isFinite(t) ? isoDay(new Date(t)) : undefined;
}

/**
 * A small RSS 2.0 / Atom reader for titles, links and dates only. It never expands entities
 * beyond the five predefined ones (no DTD, no external entities), and caps size and item count.
 */
export function parseFeed(xml: string, feedUrl: string, maxItems = 50): FeedItem[] {
  if (typeof xml !== 'string' || !xml || xml.length > MAX_FEED_BYTES) return [];
  const firstItem = xml.search(/<(item|entry)[\s>]/i);
  const head = firstItem >= 0 ? xml.slice(0, firstItem) : xml;
  const feed = field(head, ['title']) || domainOf(feedUrl);
  const out: FeedItem[] = [];
  const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  for (let m = re.exec(xml); m && out.length < maxItems; m = re.exec(xml)) {
    const block = m[2];
    const title = clipText(field(block, ['title']), HEADLINE_CHARS);
    const link = itemLink(block);
    let url: string | null = null;
    try {
      url = safeLink(new URL(link, feedUrl).toString());
    } catch {}
    if (!title || !url) continue;
    const date = dayOf(field(block, ['pubDate', 'published', 'updated', 'dc:date']));
    out.push({ title, url, date, feed });
  }
  // Newest first where dated (feeds are usually in order already).
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (b.x.date ?? '').localeCompare(a.x.date ?? '') || a.i - b.i)
    .map(({ x }) => x);
}

/** Feed items about the question, as sources. */
export function feedSources(
  items: FeedItem[],
  words: string[],
  max = NEWS_PER_SOURCE,
): WebSource[] {
  return pickMatching(items, words, (i) => i.title, max).map((i) => ({
    name: i.feed,
    title: i.title,
    url: i.url,
    text: i.title,
    domain: domainOf(i.url),
    date: i.date,
  }));
}

/** Takes turns between the news sources so one doesn't crowd out the others. */
export function interleave(lists: WebSource[][], max = MAX_NEWS): WebSource[] {
  const out: WebSource[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < max && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const s = l[i];
      if (!s || out.length >= max) continue;
      const key = s.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

/**
 * The main text of one web page (a shared or pasted link), readability-style: drop scripts,
 * menus, headers, footers and link lists, keep headings, paragraphs and list items from the
 * article (or main part) of the page. Own code (Apache-2.0, no library). Pure; tested in
 * __tests__/page-test.ts.
 */

export const PAGE_LIMITS = {
  /** Bigger pages are cut here before reading (a long article is ~200–500 KB of HTML). */
  maxHtmlChars: 3_000_000,
  /** Text kept from a page (DOC_LIMITS cuts it into parts for the model). */
  maxTextChars: 120_000,
  timeoutMs: 12_000,
} as const;

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  deg: '°',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  agrave: 'à',
  ouml: 'ö',
  uuml: 'ü',
  auml: 'ä',
  szlig: 'ß',
  ccedil: 'ç',
  times: '×',
  middot: '·',
  bull: '•',
  euro: '€',
  pound: '£',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

const clean = (s: string) =>
  decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Elements that are never the page's text. */
const JUNK = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'form',
  'button',
  'select',
  'nav',
  'header',
  'footer',
  'aside',
  'menu',
  'figure',
];

function stripJunk(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const t of JUNK) h = h.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}>`, 'gi'), ' ');
  // Footnote marks ("[12]") and "[edit]" links on wikis; hidden parts.
  h = h.replace(/<sup\b[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, ' ');
  h = h.replace(/<span\b[^>]*class="[^"]*editsection[^"]*"[\s\S]*?<\/span>\s*<\/span>/gi, ' ');
  h = h.replace(
    /<(div|span|section)\b[^>]*(aria-hidden="true"|\bhidden\b|display:\s*none)[^>]*>[\s\S]*?<\/\1>/gi,
    ' ',
  );
  return h;
}

function inner(html: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)<\\/${tag}>`, 'i').exec(html);
  return m ? m[1] : null;
}

const BLOCK = /<(h[1-6]|p|li|blockquote|pre|dd|dt|figcaption|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;

function blocks(region: string): string[] {
  const out: string[] = [];
  for (const m of region.matchAll(BLOCK)) {
    const tag = m[1].toLowerCase();
    const body = m[2];
    const text = clean(body);
    if (!text) continue;
    const heading = tag[0] === 'h' && tag.length === 2;
    const linked = [...body.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].reduce(
      (n, a) => n + clean(a[1]).length,
      0,
    );
    const density = linked / text.length;
    // Menus and link lists: mostly link text, or a few words that are all a link.
    if (density > 0.6 || (!heading && text.length < 25 && density > 0.3)) continue;
    if (!heading && text.length < 3) continue;
    out.push(heading ? `\n${text}` : text);
  }
  return out;
}

const textLength = (bs: string[]) => bs.reduce((n, b) => n + b.length, 0);

/** The page title and main text (empty text when nothing readable was found). */
export function extractPage(html: string): { title: string; text: string } {
  const h = html.slice(0, PAGE_LIMITS.maxHtmlChars);
  const og = /<meta\b[^>]*property="og:title"[^>]*content="([^"]*)"/i.exec(h)?.[1];
  const title = clean(og ?? inner(h, 'title') ?? '').slice(0, 200);
  const body = stripJunk(inner(h, 'body') ?? h);
  // The article, else the main part, else the whole page: the first with real text in it.
  let best: string[] = [];
  for (const tag of ['article', 'main', 'body']) {
    const region = tag === 'body' ? body : inner(body, tag);
    if (!region) continue;
    const bs = blocks(region);
    if (textLength(bs) >= 400 || tag === 'body') {
      best = textLength(bs) >= textLength(best) * 0.5 ? bs : best;
      if (textLength(best) >= 400) break;
    }
  }
  let text = best.join('\n').trim();
  if (text.length < 200) text = clean(body);
  return { title, text: text.slice(0, PAGE_LIMITS.maxTextChars) };
}

/** Only ordinary web addresses are read (no local files, no internal addresses by name). */
export function readableUrl(url: string): boolean {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  if (!m) return false;
  const host = m[1].toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  // Private and loopback addresses (a link must not reach into the home network).
  if (/^(10|127|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return host.includes('.');
}

/** The site name shown with the answer ("en.wikipedia.org"). */
export function siteOf(url: string): string {
  return /^https?:\/\/([^/:?#]+)/i.exec(url)?.[1].replace(/^www\./, '') ?? url;
}

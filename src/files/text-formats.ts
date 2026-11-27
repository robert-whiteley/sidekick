/**
 * Text kept in markup: web pages and e-book chapters (HTML), and RTF. All of the words, in order,
 * with paragraphs and list items on their own lines. Pure.
 */
import { cp1252 } from './bytes';
import { decodeXmlEntities } from './xml';

const HTML_NAMED: Record<string, string> = {
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
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  deg: '°',
  times: '×',
  divide: '÷',
  shy: '',
  laquo: '«',
  raquo: '»',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  agrave: 'à',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  ccedil: 'ç',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
};

const BLOCK =
  /^(p|div|br|li|ul|ol|h[1-6]|tr|table|section|article|header|footer|blockquote|pre|hr|dt|dd|dl|figure|figcaption|main|nav|aside|title)$/i;

/** A page's (or chapter's) title and text. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeXmlEntities(
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, ''),
    HTML_NAMED,
  )
    .replace(/\s+/g, ' ')
    .trim();
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const text = body
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (m, tag: string) => {
      const t = tag.toLowerCase();
      if (t === 'li' && m[1] !== '/') return '\n- ';
      if (t === 'td' || t === 'th') return m[1] === '/' ? ' | ' : '';
      return BLOCK.test(t) ? '\n' : '';
    })
    .replace(/<[^>]*>/g, '');
  return { title, text: tidy(decodeXmlEntities(text, HTML_NAMED)).replace(/\n{2,}/g, '\n') };
}

/** Spaces and blank lines tidied; " | " left at the end of table rows removed. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\| *\n/g, '\n')
    .replace(/ *\n */g, '\n')
    .replace(/\n- *\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Groups whose text isn't part of the document (fonts, colours, styles, pictures…). */
const RTF_SKIP = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'header',
  'footer',
  'headerl',
  'headerr',
  'footerl',
  'footerr',
  'fldinst',
]);

/** The words of an RTF document. */
export function rtfToText(rtf: string): string {
  const out: string[] = [];
  // Per group: skipping it, and how many characters follow a \u (the \uc number).
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pendingSkip = 0;
  let i = 0;
  const n = rtf.length;
  const put = (s: string) => {
    if (pendingSkip > 0) {
      pendingSkip--;
      return;
    }
    if (!skip) out.push(s);
  };
  while (i < n) {
    const c = rtf[i];
    if (c === '{') {
      stack.push({ skip, uc });
      i++;
      continue;
    }
    if (c === '}') {
      const top = stack.pop();
      if (top) ({ skip, uc } = top);
      i++;
      continue;
    }
    if (c === '\\') {
      const d = rtf[i + 1];
      if (d === '\\' || d === '{' || d === '}') {
        put(d);
        i += 2;
        continue;
      }
      if (d === '*') {
        skip = true;
        i += 2;
        continue;
      }
      if (d === "'") {
        const b = parseInt(rtf.slice(i + 2, i + 4), 16);
        if (!Number.isNaN(b)) put(cp1252(b));
        i += 4;
        continue;
      }
      if (d === '~') {
        put(' ');
        i += 2;
        continue;
      }
      if (d === '-' || d === '_') {
        i += 2;
        continue;
      }
      if (d === '\n' || d === '\r') {
        put('\n');
        i += 2;
        continue;
      }
      const m = /^([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i + 1, i + 40));
      if (!m) {
        i += 2;
        continue;
      }
      i += 1 + m[0].length;
      const word = m[1];
      const arg = m[2] != null ? parseInt(m[2], 10) : null;
      pendingSkip = 0;
      if (RTF_SKIP.has(word)) skip = true;
      else if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') put('\n');
      else if (word === 'tab' || word === 'cell') put(word === 'cell' ? ' | ' : '\t');
      else if (word === 'row') put('\n');
      else if (word === 'uc' && arg != null) uc = arg;
      else if (word === 'u' && arg != null) {
        put(String.fromCharCode(arg < 0 ? arg + 65536 : arg));
        pendingSkip = uc;
      } else if (word === 'emdash') put('—');
      else if (word === 'endash') put('–');
      else if (word === 'bullet') put('•');
      else if (word === 'lquote') put('‘');
      else if (word === 'rquote') put('’');
      else if (word === 'ldblquote') put('“');
      else if (word === 'rdblquote') put('”');
      continue;
    }
    if (c === '\n' || c === '\r') {
      i++;
      continue;
    }
    put(c);
    i++;
  }
  return tidy(out.join(''));
}

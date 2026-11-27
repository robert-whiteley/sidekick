/**
 * A small, forgiving XML scanner for the documents inside Office, OpenDocument and EPUB files:
 * open tags (with their attribute text), close tags and text, in order. No DOM, so a big sheet's
 * XML is walked once without building a tree. Pure.
 */

export type XmlHandlers = {
  open?: (name: string, attrs: string, selfClosing: boolean) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
};

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** &amp; &lt; &#233; &#xE9; (and the few named ones XML and simple HTML use). */
export function decodeXmlEntities(s: string, named: Record<string, string> = NAMED): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return named[e] ?? named[e.toLowerCase()] ?? m;
  });
}

/** One attribute's value from a tag's attribute text, decoded, or null. */
export function attr(attrs: string, name: string): string | null {
  let i = 0;
  while (true) {
    i = attrs.indexOf(name, i);
    if (i < 0) return null;
    const before = i === 0 ? ' ' : attrs[i - 1];
    let j = i + name.length;
    while (attrs[j] === ' ' || attrs[j] === '\n' || attrs[j] === '\t' || attrs[j] === '\r') j++;
    if (/\s/.test(before) && attrs[j] === '=') {
      j++;
      while (/\s/.test(attrs[j] ?? '')) j++;
      const q = attrs[j];
      if (q === '"' || q === "'") {
        const end = attrs.indexOf(q, j + 1);
        if (end > j) return decodeXmlEntities(attrs.slice(j + 1, end));
      }
    }
    i += name.length;
  }
}

/** Walks [xml], calling the handlers; [stop] returning true ends the walk early. */
export function scanXml(xml: string, h: XmlHandlers, stop?: () => boolean): void {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    if (stop?.()) return;
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      if (h.text && i < n) h.text(decodeXmlEntities(xml.slice(i)));
      return;
    }
    if (lt > i && h.text) h.text(decodeXmlEntities(xml.slice(i, lt)));
    const c = xml[lt + 1];
    if (c === '!') {
      if (xml.startsWith('<!--', lt)) {
        const end = xml.indexOf('-->', lt + 4);
        i = end < 0 ? n : end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt + 9);
        if (h.text) h.text(xml.slice(lt + 9, end < 0 ? n : end));
        i = end < 0 ? n : end + 3;
        continue;
      }
      const end = xml.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (c === '?') {
      const end = xml.indexOf('?>', lt);
      i = end < 0 ? n : end + 2;
      continue;
    }
    // A tag: find its end outside quoted attribute values.
    let j = lt + 1;
    let q = '';
    while (j < n) {
      const ch = xml[j];
      if (q) {
        if (ch === q) q = '';
      } else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '>') break;
      j++;
    }
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '/') {
      h.close?.(body.slice(1).trim());
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    let k = 0;
    while (k < inner.length && !/\s/.test(inner[k])) k++;
    const name = inner.slice(0, k);
    h.open?.(name, inner.slice(k), selfClosing);
    if (selfClosing) h.close?.(name);
  }
}

/** A tag name without its namespace prefix ("w:p" → "p"). */
export const local = (name: string) => {
  const c = name.indexOf(':');
  return c < 0 ? name : name.slice(c + 1);
};

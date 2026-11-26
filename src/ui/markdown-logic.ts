/**
 * The small markdown subset typed answers may use (prompts.ts): paragraphs, headings, bullet and
 * numbered lists, bold / italic, inline code and small tables. Anything else stays plain text.
 * Our own few lines instead of a library: nothing to licence, and it copes with half-written
 * text while an answer streams in. Pure; tested in __tests__/markdown-test.ts.
 */

export type Span = { text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { kind: 'para'; spans: Span[] }
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'item'; marker: string; spans: Span[]; indent: number }
  | { kind: 'table'; header: Span[][]; rows: Span[][][] };

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|?\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** Bold (**x** / __x__), italic (*x* / _x_) and `code` (shown plain). Unclosed marks drop. */
export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  const re =
    /\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const plain = (s: string) => {
    // A mark still open while the answer streams ("**Ste"): hidden, not shown as stars.
    const t = s.replace(/\*\*|__|`/g, '');
    if (t) out.push({ text: t });
  };
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index));
    if (m[1] ?? m[2]) out.push({ text: (m[1] ?? m[2])!, bold: true });
    else if (m[3] ?? m[4]) out.push({ text: (m[3] ?? m[4])!, italic: true });
    else out.push({ text: m[5]! });
    last = m.index + m[0].length;
  }
  plain(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => parseInline(c.trim()));

/** Splits an answer into blocks. Plain text with no markdown gives one paragraph per blank line. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'para', spans: parseInline(para.join('\n')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    // A table needs its |---| line under the header (otherwise it is ordinary text).
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      flush();
      const header = cells(line);
      const rows: Span[][][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]) && lines[i].includes('|')) {
        rows.push(cells(lines[i]));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: 'heading', spans: parseInline(h[1]) });
      continue;
    }
    const b = BULLET.exec(line);
    // "**Bold** start" is not a bullet: the marker needs a space after one star.
    if (b && !/^\s*\*\*/.test(line)) {
      flush();
      blocks.push({ kind: 'item', marker: '•', spans: parseInline(b[2]), indent: indentOf(b[1]) });
      continue;
    }
    const n = NUMBERED.exec(line);
    if (n) {
      flush();
      blocks.push({
        kind: 'item',
        marker: `${n[2]}.`,
        spans: parseInline(n[3]),
        indent: indentOf(n[1]),
      });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

const indentOf = (ws: string) => Math.min(2, Math.floor(ws.replace(/\t/g, '  ').length / 2));

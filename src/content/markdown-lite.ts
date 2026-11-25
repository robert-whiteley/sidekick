/**
 * A tiny Markdown reader for the bundled legal texts (privacy policy, licences): headings,
 * paragraphs, list items and table rows. Inline marks are flattened to plain text; links keep
 * their address so it stays visible. Not a general Markdown parser.
 */

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'item'; depth: number; text: string }
  | { type: 'row'; cells: string[] };

/** "**a** [b](https://x) `c`" -> "a b (https://x) c". */
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t: string, u: string) =>
      t === u || /^https?:\/\//.test(t) ? t : `${t} (${u})`,
    )
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: plain(para.join(' ')) });
    para = [];
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (h) {
      flush();
      blocks.push({ type: 'heading', level: h[1].length, text: plain(h[2]) });
    } else if (line.trim().startsWith('|')) {
      flush();
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map(plain);
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // the |---|---| line
      blocks.push({ type: 'row', cells });
    } else if (li) {
      flush();
      blocks.push({ type: 'item', depth: Math.floor(li[1].length / 2), text: plain(li[2]) });
    } else if (/^\s+\S/.test(line) && blocks.at(-1)?.type === 'item' && !para.length) {
      const last = blocks.at(-1) as Extract<Block, { type: 'item' }>;
      last.text = `${last.text} ${plain(line)}`;
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

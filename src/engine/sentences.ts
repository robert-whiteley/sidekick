/**
 * Splits streamed text into whole sentences so speech can start before the answer finishes.
 * Returns the sentences that are complete and the unfinished remainder.
 */
export function takeSentences(buffer: string): { done: string[]; rest: string } {
  const done: string[] = [];
  // A sentence ends at . ! ? or a newline (plus closing quotes/brackets) followed by whitespace,
  // so "3.5" or "e.g.x" never split mid-number. The final sentence waits until more text arrives.
  const end = /\n|[.!?]+["')\]]*(?=\s)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = end.exec(buffer))) {
    const stop = m.index + m[0].length;
    const s = buffer.slice(last, stop).trim();
    if (s) done.push(s);
    last = stop;
  }
  return { done, rest: buffer.slice(last) };
}

/** Removes markdown symbols that a speech engine would read out loud. */
export function forSpeech(text: string): string {
  return text
    .replace(/[*_`#>]+/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

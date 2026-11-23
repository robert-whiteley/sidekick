/**
 * Inferred facts: the model reads a few of the owner's own lines and proposes durable personal
 * facts. They are saved as "suggested" and only used in answers once the owner approves them.
 */

export const MAX_FACT_LINES = 10;

export function factPrompt(lines: string[]): string {
  return (
    'Below are things I said out loud. List only lasting personal facts about me or people close ' +
    'to me that I would want remembered later (codes, numbers, birthdays, names, preferences, ' +
    'plans with a date). Write each as a short sentence starting with "My" or a name, one per ' +
    'line, no numbering. Do not guess or add anything I did not say. If there are none, write ' +
    'exactly NONE.\n\n' +
    lines.map((l) => `- ${l}`).join('\n')
  );
}

/** Parses the model's reply into fact sentences (deduplicated, bounded). */
export function parseFacts(reply: string): string[] {
  const out: string[] = [];
  for (const raw of reply.split('\n')) {
    const line = raw
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .replace(/[*_`]+/g, '')
      .trim();
    if (!line || /^none\b/i.test(line)) continue;
    if (/^(here|sure|okay|these|the following|facts?:)/i.test(line)) continue;
    if (line.length < 8 || line.length > 160) continue;
    if (/\?$/.test(line)) continue;
    const s = /[.!]$/.test(line) ? line : `${line}.`;
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= 5) break;
  }
  return out;
}

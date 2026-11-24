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

/** Replies about the task rather than facts ("Please provide the conversation…"). */
const META =
  /^(please|sorry|i|i'm|i am|you|your|could|can|there|it|this|based|as an|unfortunately|no )\b/i;

/**
 * Parses the model's reply into fact sentences (deduplicated, bounded). With the owner's `lines`,
 * a fact must start with "My"/"Our" or a word the owner actually said (a name), so the model's
 * remarks about the task are never suggested as facts.
 */
export function parseFacts(reply: string, lines?: string[]): string[] {
  const said = lines
    ? new Set(
        lines
          .join(' ')
          .toLowerCase()
          .match(/[\p{L}\p{N}']+/gu) ?? [],
      )
    : null;
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
    if (META.test(line)) continue;
    const first = (line.match(/^[\p{L}\p{N}']+/u)?.[0] ?? '').toLowerCase().replace(/'s$/, '');
    if (said && !/^(my|our)$/.test(first) && !said.has(first)) continue;
    const s = /[.!]$/.test(line) ? line : `${line}.`;
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= 5) break;
  }
  return out;
}

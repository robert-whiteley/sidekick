/**
 * Round trip: each English line's translation (from a bench output file) is translated back into
 * English with the app's prompt, without context; score.py then compares it with the original
 * English (ref = the original line).
 *
 *   node bench/interpreter/roundtrip.ts out.jsonl > back.jsonl
 */
import { readFileSync } from 'node:fs';

import {
  interpretLanguage,
  interpretSystem,
  parseTurnReply,
  turnPrompt,
  // @ts-expect-error -- plain Node runs this file and needs the .ts extension
} from '../../src/engine/interpreter-logic.ts';

const mine = interpretLanguage('en')!;
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as {
    lang: string;
    i: number;
    from: string;
    src: string;
    reply: string;
  };
  if (r.from !== 'en') continue;
  const theirs = interpretLanguage(r.lang)!;
  const there = parseTurnReply(r.reply, r.src) ?? '';
  console.log(
    JSON.stringify({
      lang: r.lang,
      i: r.i,
      who: 'them',
      from: r.lang,
      to: 'en',
      src: there,
      ref: r.src,
      system: interpretSystem(mine, theirs),
      prompt: turnPrompt(mine, theirs, 'them', there, []),
    }),
  );
}

/**
 * Writes the interpreter bench cases as JSON lines: for each language and each turn of
 * phrases.json, the app's own system prompt and turn prompt (src/engine/interpreter-logic.ts),
 * the source text and the reference translation. Earlier turns are given as context with their
 * reference translations, as the app would have them.
 *
 *   node bench/interpreter/prompts.ts [langs] > cases.jsonl     (Node 22.18+ runs .ts directly)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  END_CHECK_MAX_TOKENS,
  endCheckPrompt,
  interpretLanguage,
  interpretSystem,
  type InterpretTurn,
  turnPrompt,
  // @ts-expect-error -- plain Node runs this file and needs the .ts extension
} from '../../src/engine/interpreter-logic.ts';

type Turn = { who: 'me' | 'them'; scene: string } & Record<string, string>;
const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, 'phrases.json'), 'utf8')) as {
  langs: string[];
  turns: Turn[];
};
const langs = (process.argv[2] ?? data.langs.filter((l) => l !== 'en').join(',')).split(',');
const mine = interpretLanguage('en')!;

for (const code of langs) {
  const theirs = interpretLanguage(code)!;
  const system = interpretSystem(mine, theirs);
  const recent: InterpretTurn[] = [];
  let scene = '';
  data.turns.forEach((t, i) => {
    if (t.scene !== scene) {
      scene = t.scene;
      recent.length = 0; // a new conversation
    }
    const src = t.who === 'me' ? t.en : t[code];
    const ref = t.who === 'me' ? t[code] : t.en;
    const prompt = turnPrompt(mine, theirs, t.who, src, recent);
    console.log(
      JSON.stringify({
        lang: code,
        i,
        who: t.who,
        from: t.who === 'me' ? 'en' : code,
        to: t.who === 'me' ? code : 'en',
        src,
        ref,
        system,
        prompt,
      }),
    );
    recent.push({ side: t.who, heard: src, said: ref, at: i });
  });
}

// The owner talking to Sidekick (or not): STOP / SWITCH / NO expected. Every owner line of the
// conversations goes through too (expect "say"), with no context, through the same turn prompt.
const control = (data as unknown as { control?: { en: string; expect: string }[] }).control ?? [];
const owner = data.turns.filter((t) => t.who === 'me').map((t) => ({ en: t.en, expect: 'say' }));
for (const code of langs) {
  const theirs = interpretLanguage(code)!;
  [...control, ...owner].forEach((c, i) => {
    console.log(
      JSON.stringify({
        lang: code,
        i,
        who: 'me',
        control: c.expect,
        src: c.en,
        system: interpretSystem(mine, theirs),
        prompt: turnPrompt(mine, theirs, 'me', c.en, []),
      }),
    );
    // The second look the app takes when the turn reply says END (score.py uses it only then).
    console.log(
      JSON.stringify({
        lang: code,
        i,
        who: 'me',
        check: true,
        src: c.en,
        system: interpretSystem(mine, theirs),
        prompt: endCheckPrompt(theirs, c.en),
        maxTokens: END_CHECK_MAX_TOKENS,
      }),
    );
  });
}

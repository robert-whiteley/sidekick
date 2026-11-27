/**
 * Does a conversation request start the interpreter, and a text to translate not? Two steps, as
 * in the app: the sorter (decide-logic.ts catalogSystem, one word) and then the translate
 * tool's arguments (tools-logic.ts fillPrompt; `talk: true` opens the interpreter). Writes cases
 * in mt_gemma.py's format; the reply's first word / the JSON is the decision.
 *
 *   node --import ./bench/interpreter/ts-resolve.mjs bench/interpreter/routing.ts > routing.jsonl
 */
// @ts-expect-error -- plain Node runs this file and needs the .ts extension
import { catalogSystem, DECIDE_TOOLS } from '../../src/engine/decide-logic.ts';
// @ts-expect-error -- as above
import { fillPrompt, ROUTER_SYSTEM, toolByName } from '../../src/engine/tools-logic.ts';

const cases: [string, string][] = [
  ['help me talk to this taxi driver in Spanish', 'talk'],
  ['be my interpreter, she speaks Japanese', 'talk'],
  ['translate for me and the driver, he speaks German', 'talk'],
  ['I need to talk to the pharmacist, she only speaks Italian', 'talk'],
  ['can you interpret between me and this lady in Arabic', 'talk'],
  ["translate 'where is the station' into Spanish", 'text'],
  ['how do you say thank you in Japanese', 'answer'],
  ['what language do they speak in Brazil', 'answer'],
  ['is French hard to learn', 'answer'],
];
// As decideRequest offers them with no draft, no photo and no picture model.
const system = catalogSystem(
  DECIDE_TOOLS.filter(
    (t: { name: string }) => !['draft', 'edit_photo', 'make_picture'].includes(t.name),
  ),
);
const now = new Date('2026-11-26T15:00:00');
cases.forEach(([q, expect], i) => {
  const base = { lang: 'route', i, route: expect, src: q };
  console.log(
    JSON.stringify({ ...base, i: `sort${i}`, system, prompt: `Request: ${q}`, maxTokens: 5 }),
  );
  console.log(
    JSON.stringify({
      ...base,
      i: `fill${i}`,
      system: ROUTER_SYSTEM,
      prompt: fillPrompt(q, now, toolByName('translate')!),
      maxTokens: 140,
    }),
  );
});

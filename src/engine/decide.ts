/**
 * What a request needs, decided by the model in any wording or language (decide-logic.ts): an
 * answer, an online lookup, or one phone tool. A short pass with its own system prompt (the tool
 * list with one line each, ~560 tokens), kept read in next to the chat's, so each request costs
 * only its own words and one word of reply (median 1.7 s on the Pixel 5; docs/BENCH.md).
 */
import { askLlm } from './llm';
import {
  catalogSystem,
  decidePrompt,
  DECIDE_TOOLS,
  parseClassify,
  type Decision,
} from './decide-logic';

/**
 * The decision for [question]. What is offered follows the app's state, never the words: "draft"
 * (send or cancel) only while a draft waits, "edit_photo" only with a photo, "make_picture" only once
 * the picture model is downloaded. A lookup is offered even with online lookup off:
 * then the answer is offline and the chat offers a web search in the browser instead.
 */
export async function decideRequest(
  question: string,
  opts: {
    draftOpen?: boolean;
    photo?: boolean;
    pictures?: boolean;
    /** The chat's last exchange, when recent: a short reply ("yes", "and in French?") is read with it. */
    previous?: { q: string; a: string };
  } = {},
): Promise<{ decision: Decision; ms: number; reply: string }> {
  const t0 = Date.now();
  const tools = DECIDE_TOOLS.filter(
    (t) =>
      (t.name !== 'draft' || opts.draftOpen) &&
      (t.name !== 'edit_photo' || opts.photo) &&
      (t.name !== 'make_picture' || opts.pictures),
  );
  const { text } = await askLlm(decidePrompt(question, opts.previous), null, () => {}, {
    system: catalogSystem(tools),
    maxTokens: 5,
    scratch: true,
    cacheSystem: true,
  });
  return {
    decision: parseClassify(text, tools),
    ms: Date.now() - t0,
    reply: text.trim().slice(0, 30),
  };
}

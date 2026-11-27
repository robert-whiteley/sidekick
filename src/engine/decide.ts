/**
 * What a request needs, decided by the model in any wording or language (decide-logic.ts): an
 * answer, an online lookup, or one phone tool. A short pass with its own system prompt (the tool
 * list with one line each, ~560 tokens), kept read in next to the chat's, so each request costs
 * only its own words and one word of reply (median 1.7 s on the Pixel 5; docs/BENCH.md).
 */
import { askLlm } from './llm';
import { catalogSystem, DECIDE_TOOLS, parseClassify, type Decision } from './decide-logic';

/**
 * The decision for [question]. What is offered follows the app's state, never the words: "draft"
 * (send or cancel) only while a draft waits, "edit_photo" only with a photo. "make_picture" is always
 * offered: without the picture model (or on iPhone) its answer says so and offers the download, so
 * a drawing request is never sent to a web search instead. A lookup is offered even with online lookup off:
 * then the answer is offline and the chat offers a web search in the browser instead.
 */
export async function decideRequest(
  question: string,
  opts: { draftOpen?: boolean; photo?: boolean } = {},
): Promise<{ decision: Decision; ms: number; reply: string }> {
  const t0 = Date.now();
  const tools = DECIDE_TOOLS.filter(
    (t) => (t.name !== 'draft' || opts.draftOpen) && (t.name !== 'edit_photo' || opts.photo),
  );
  const { text } = await askLlm(`Request: ${question}`, null, () => {}, {
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

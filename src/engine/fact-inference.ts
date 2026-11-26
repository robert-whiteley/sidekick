import SidekickNative from '../../modules/sidekick-native';
import { askLlmInBackground, cancelLlm } from './llm';
import {
  factPrompt,
  MAX_FACT_LINES,
  parseFacts,
  parseSensitive,
  sensitiveCheckPrompt,
} from '@/memory/fact-extraction';
import { finishPersonFactCheck, uncheckedPersonFacts } from '@/memory/people';
import { markFactsScanned, ownerLinesToScan, suggestFacts } from '@/memory/store';
import { getSettings } from './settings';

let running: Promise<void> | null = null;
let cancelled = false;

/**
 * Reads a batch of the owner's new lines and proposes facts for approval. Runs only when the
 * model is already in memory (never loads it just for this); a question cancels it.
 */
export function inferFactsIfIdle(): Promise<void> {
  if (running || !SidekickNative.llmIsLoaded()) return running ?? Promise.resolve();
  cancelled = false;
  running = (async () => {
    await checkPersonFacts();
    if (cancelled) return;
    const lines = await ownerLinesToScan(MAX_FACT_LINES);
    if (!lines.length) return;
    const sensitiveOk = getSettings().suggestSensitiveFacts;
    const prompt = factPrompt(
      lines.map((l) => l.text),
      sensitiveOk,
    );
    const { text } = await askLlmInBackground(prompt, null, { maxTokens: 120 });
    if (cancelled) return; // partial output: try these lines again later
    await suggestFacts(
      parseFacts(
        text,
        lines.map((l) => l.text),
      ),
    );
    await markFactsScanned(lines.map((l) => l.id));
  })()
    .catch((e) => {
      if (!cancelled) console.log(`[facts] inference failed: ${String(e)}`);
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/**
 * What other people said about themselves waits here until the model has said which lines touch
 * a private topic (health, beliefs, sexuality, politics, money): those are deleted, the rest are
 * suggested on the person's page. With private topics allowed, nothing waits.
 */
async function checkPersonFacts() {
  const facts = await uncheckedPersonFacts(MAX_FACT_LINES);
  if (!facts.length) return;
  if (getSettings().suggestSensitiveFacts) {
    await finishPersonFactCheck(
      facts.map((f) => f.id),
      [],
    );
    return;
  }
  const { text } = await askLlmInBackground(sensitiveCheckPrompt(facts.map((f) => f.text)), null, {
    maxTokens: 20,
  });
  if (cancelled) return;
  const marked = parseSensitive(text, facts.length);
  const drop = facts.filter((_, i) => !marked || marked.has(i)).map((f) => f.id);
  const keep = facts.filter((f) => !drop.includes(f.id)).map((f) => f.id);
  console.log(`[facts] person facts checked: ${keep.length} kept, ${drop.length} private`);
  await finishPersonFactCheck(keep, drop);
}

/** Stops a running fact pass so a question gets the model at once. */
export async function stopFactInference() {
  if (!running) return;
  cancelled = true;
  cancelLlm();
  await running;
}

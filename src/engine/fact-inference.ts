import SidekickNative from '../../modules/sidekick-native';
import { askLlmInBackground, cancelLlm } from './llm';
import { factPrompt, MAX_FACT_LINES, parseFacts } from '@/memory/fact-extraction';
import { markFactsScanned, ownerLinesToScan, suggestFacts } from '@/memory/store';

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
    const lines = await ownerLinesToScan(MAX_FACT_LINES);
    if (!lines.length) return;
    const { text } = await askLlmInBackground(factPrompt(lines.map((l) => l.text)), null, {
      maxTokens: 120,
    });
    if (cancelled) return; // partial output: try these lines again later
    await suggestFacts(parseFacts(text));
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

/** Stops a running fact pass so a question gets the model at once. */
export async function stopFactInference() {
  if (!running) return;
  cancelled = true;
  cancelLlm();
  await running;
}

import SidekickNative from '../../modules/sidekick-native';
import { askLlm, cancelLlm } from './llm';
import { getSettings } from './settings';
import { followupPrompt, MAX_FOLLOWUP_LINES, parseFollowups } from '@/memory/followup-logic';
import { linesForFollowups, markFollowupsScanned, suggestFollowups } from '@/memory/followups';

let running: Promise<void> | null = null;
let cancelled = false;

/**
 * Reads a batch of recent lines (conversations, questions, photo notes) and proposes to-dos,
 * events and reminders for approval. Like fact inference: only when the model is already loaded,
 * and a question cancels it.
 */
export function inferFollowupsIfIdle(): Promise<void> {
  if (running || !getSettings().suggestFollowups || !SidekickNative.llmIsLoaded()) {
    return running ?? Promise.resolve();
  }
  cancelled = false;
  running = (async () => {
    const lines = await linesForFollowups(MAX_FOLLOWUP_LINES);
    if (!lines.length) return;
    const { text } = await askLlm(followupPrompt(lines), null, () => {}, { maxTokens: 160 });
    if (cancelled) return; // partial output: try these lines again later
    await suggestFollowups(parseFollowups(text, lines));
    await markFollowupsScanned(lines.map((l) => l.id));
  })()
    .catch((e) => {
      if (!cancelled) console.log(`[followups] inference failed: ${String(e)}`);
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/** Stops a running pass so a question gets the model at once. */
export async function stopFollowupInference() {
  if (!running) return;
  cancelled = true;
  cancelLlm();
  await running;
}

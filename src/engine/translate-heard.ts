import SidekickNative from '../../modules/sidekick-native';
import {
  detectLanguage,
  parseTranslations,
  translationPrompt,
  withTranslation,
} from './language-logic';
import { liveTranscript } from './live-transcript';
import { askLlmInBackground, cancelLlm } from './llm';
import { getSettings } from './settings';
import { linesToCheck, markEnglish, saveTranslation } from '@/memory/translations';

/** Lines per model pass: short enough for a Pixel 5 (~240 tokens out). */
export const TRANSLATE_BATCH = 4;

let running: Promise<void> | null = null;
let cancelled = false;
let again = false;

/**
 * "Understand other languages around me": each heard line in another language gets an English
 * translation stored with it (shown under the line, searchable, used by answers, notes and
 * recaps). Runs in the background after new lines, only when the model is already loaded; waits
 * behind questions and is stopped by them. English lines are only marked as checked.
 */
export function translateHeardIfIdle(): Promise<void> {
  if (!getSettings().understandOtherLanguages) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  cancelled = false;
  again = false;
  running = (async () => {
    const lines = await linesToCheck(40);
    const foreign: { id: number; at: number; text: string; code: string }[] = [];
    const english: number[] = [];
    for (const l of lines) {
      const d = detectLanguage(l.text);
      if (d.code !== 'en' && d.confident) foreign.push({ ...l, code: d.code });
      else english.push(l.id);
    }
    await markEnglish(english);
    if (!foreign.length || !SidekickNative.llmIsLoaded()) return;
    // Oldest of the newest batch first, so a conversation reads in order.
    const batch = foreign.slice(0, TRANSLATE_BATCH).reverse();
    const { text } = await askLlmInBackground(translationPrompt(batch), null, { maxTokens: 240 });
    if (cancelled) return; // partial output: tried again on the next line
    const out = parseTranslations(text, batch.length);
    let saved = 0;
    for (let i = 0; i < batch.length; i++) {
      const en = out[i];
      if (!en) continue;
      const stored = withTranslation(batch[i].text, en);
      await saveTranslation(batch[i].id, batch[i].code, stored);
      liveTranscript.retext(batch[i].at, stored);
      saved++;
    }
    if (saved && foreign.length > batch.length) again = true;
  })()
    .catch((e) => {
      if (!cancelled) console.log(`[translate] failed: ${String(e)}`);
    })
    .finally(() => {
      running = null;
      if (again && !cancelled) void translateHeardIfIdle();
    });
  return running;
}

/** Stops a running pass so a question gets the model at once. */
export async function stopTranslateHeard() {
  if (!running) return;
  cancelled = true;
  cancelLlm();
  await running;
}

/**
 * The phone is short of memory. Android: the native side (MemoryWatch.kt) has already freed the
 * big models by Android's signals (onTrimMemory, low-memory flag) and tells JS, which drops its own
 * caches. iPhone: a memory warning frees the memory-search model and, unless it is answering, the
 * chat model here. Everything freed loads again on demand (next question, search or place name).
 */
import { AppState, Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { setGeoPack } from './geo';
import { llmBusy, unloadLlm } from './llm';

/** What JS frees for one warning. Pure; tested. */
export function jsPlan(o: { platform: string; llmBusy: boolean }): {
  caches: boolean;
  embedder: boolean;
  llm: boolean;
} {
  // Android frees the models natively (also with the app closed); only JS caches are left here.
  if (o.platform === 'android') return { caches: true, embedder: false, llm: false };
  return { caches: true, embedder: true, llm: !o.llmBusy };
}

let lastAt = 0;

async function relieve(why: string) {
  const now = Date.now();
  if (now - lastAt < 10_000) return; // one warning often comes as several
  lastAt = now;
  const plan = jsPlan({ platform: Platform.OS, llmBusy: llmBusy() });
  // The place-name pack (a few MB) is read again at the next place lookup.
  if (plan.caches) setGeoPack(undefined);
  if (plan.embedder) await SidekickNative.embedUnload().catch(() => {});
  if (plan.llm) await unloadLlm().catch(() => {});
  console.log(
    `[memory] ${why}: freed caches${plan.embedder ? ', embedder' : ''}${plan.llm ? ', chat model' : ''}`,
  );
}

/** Listens for memory warnings; returns a stop function. */
export function startMemoryPressure(): () => void {
  const subs: { remove(): void }[] = [];
  if (Platform.OS === 'android')
    subs.push(
      SidekickNative.addListener('onMemoryPressure', (e) => {
        console.log(`[memory] Android ${e.level}: native freed ${e.freed.join(', ') || 'caches'}`);
        void relieve(`Android ${e.level}`);
      }),
    );
  else subs.push(AppState.addEventListener('memoryWarning', () => void relieve('memory warning')));
  return () => subs.forEach((s) => s.remove());
}

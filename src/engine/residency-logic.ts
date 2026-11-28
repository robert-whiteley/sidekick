/**
 * Which big models can be in memory together (ARCHITECTURE.md, "memory budget"). The native side
 * decides (Residency on Android, MemoryBudget on iOS: total RAM, and on iOS the memory the app may
 * still use); JS asks it, so the two never disagree. Builds without that call use the RAM rule.
 * Pure; tested in __tests__/residency-test.ts.
 */
import { LOW_RAM_MB } from '@/memory/embed-policy';

export type ResidencyState = {
  /** The native answer, or undefined on a build without it. */
  nativeAlone?: boolean;
  totalRamMb: number;
  llmLoaded: boolean;
};

/** Whether the chat model and the memory-search model can't be in memory together now. */
export function mustBeAlone(s: Pick<ResidencyState, 'nativeAlone' | 'totalRamMb'>): boolean {
  return s.nativeAlone ?? s.totalRamMb < LOW_RAM_MB;
}

/** Whether loading the memory-search model now would unload the chat model. */
export function embedderEvictsChat(s: ResidencyState): boolean {
  return s.llmLoaded && mustBeAlone(s);
}

/**
 * Whether a question's memory search may load the memory-search model. Where that would unload
 * the chat model (it is loaded again for the answer: seconds on a phone, over a minute on the
 * iPhone's CPU), only when the model said the answer is in the owner's memories; other questions
 * search by exact words. A photo question searches by words there, as the picture is read next.
 * [memory] is undefined when no sorter ran (then search by meaning, as before).
 */
export function searchByMeaning(o: {
  evictsChat: boolean;
  photo: boolean;
  memory: boolean | undefined;
}): boolean {
  if (!o.evictsChat) return true;
  if (o.photo) return false;
  return o.memory ?? true;
}

/** Receives iPhone App Intents (logic: app-intents-logic.ts). Nothing happens on Android. */
import * as AppIntents from 'expo-app-intents';
import { useCallback, useState } from 'react';

import { latestEntry } from './app-intents-logic';
import type { EntryRequest } from './entry-points';

/**
 * The newest intent's entry request (null until one arrives, or when [accept] is false: before
 * the model is in, a question is dropped rather than asked minutes later). Every invocation is
 * removed from the queue once seen, so each runs once. [onEntry] fires for each new one.
 */
export function useIntentEntry(
  accept: boolean,
  onEntry?: () => void,
): [EntryRequest | null, () => void] {
  const [entry, setEntry] = useState<EntryRequest | null>(null);
  AppIntents.useAppIntents(async (pending) => {
    if (!pending.length) return;
    const next = accept ? latestEntry(pending) : null;
    await Promise.all(
      pending.map((p) => AppIntents.removePendingInvocationAsync(p.id).catch(() => {})),
    );
    if (!next) return;
    setEntry(next);
    onEntry?.();
  });
  return [entry, useCallback(() => setEntry(null), [])];
}

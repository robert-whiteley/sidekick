/**
 * iPhone App Intents (Siri, the Shortcuts app, the Action Button, a Control Center shortcut):
 * the Swift intents in app-intents/ open the app and hand over an invocation; this turns it into
 * the same entry request the Android tile and widget use. Pure; tested in
 * __tests__/app-intents-test.ts.
 */
import type { EntryRequest } from './entry-points';

export type Invocation = {
  id: string;
  name: string;
  params?: Record<string, unknown>;
  /** When the intent ran (ms). */
  createdAt?: number;
};

/** An invocation older than this is dropped (e.g. left from before the app could answer). */
export const INTENT_MAX_AGE_MS = 2 * 60_000;

/** A question longer than this is cut (Siri dictation or a Shortcuts text can be anything). */
export const MAX_INTENT_TEXT = 2000;

/** One invocation → an entry request, or null if it is unknown or has no question. */
export function entryFromIntent(inv: Invocation): EntryRequest | null {
  switch (inv.name) {
    case 'ask': {
      const q = inv.params?.question;
      const text =
        typeof q === 'string' ? q.replace(/\s+/g, ' ').trim().slice(0, MAX_INTENT_TEXT) : '';
      return text ? { kind: 'ask', nonce: inv.id, text } : null;
    }
    case 'listen':
      return { kind: 'listen', nonce: inv.id };
    case 'look':
      return { kind: 'look', nonce: inv.id };
    default:
      return null;
  }
}

/**
 * The entry to run from the invocations waiting (oldest first): only the newest counts, since
 * the user asked for it last; older ones (say, from before the app was ready) are dropped.
 */
export function latestEntry(pending: Invocation[], now = Date.now()): EntryRequest | null {
  for (let i = pending.length - 1; i >= 0; i--) {
    const at = pending[i].createdAt;
    if (typeof at === 'number' && now - at > INTENT_MAX_AGE_MS) continue;
    const e = entryFromIntent(pending[i]);
    if (e) return e;
  }
  return null;
}

import { useEffect, useRef } from 'react';

import type { EntryKind, EntryRequest } from '@/engine/entry-points';

/**
 * Runs an entry request (tile, widget, phone assistant) once, as soon as `ready` allows, then
 * calls `onHandled` (which clears it from the route so the same link works again).
 */
export function useEntry(
  entry: EntryRequest | null,
  ready: (kind: EntryKind) => boolean,
  run: (entry: EntryRequest) => void,
  onHandled?: () => void,
) {
  const done = useRef<string | null>(null);
  const key = entry ? `${entry.kind}:${entry.nonce}` : null;
  // No deps: re-checked after every render until it is ready.
  useEffect(() => {
    if (!entry || !key) {
      done.current = null;
      return;
    }
    if (done.current === key || !ready(entry.kind)) return;
    done.current = key;
    run(entry);
    onHandled?.();
  });
}

/**
 * Share into Sidekick: text, links and pictures from any app's share sheet (Android
 * ACTION_SEND, plugins/with-share-target.js → PhoneExtras.noteIntent). The chat shows the
 * picture as "Asking about the shared picture" or puts the text in the composer.
 */
import { AppState } from 'react-native';

import { integrationsNative } from '@/integrations/native';

export type SharedItem = { text?: string; subject?: string; imagePath?: string; at: number };

export function parseShared(raw: string | null | undefined): SharedItem | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as SharedItem;
    if (!o || (typeof o.text !== 'string' && typeof o.imagePath !== 'string')) return null;
    return o;
  } catch {
    return null;
  }
}

/** The composer text for a share: the subject (a page title) and the text or link. */
export function sharedComposerText(item: SharedItem): string {
  const text = (item.text ?? '').trim();
  const subject = (item.subject ?? '').trim();
  if (subject && text && !text.includes(subject)) return `${subject}\n${text}`;
  return text || subject;
}

function take(): SharedItem | null {
  try {
    return parseShared(integrationsNative()?.takeShared?.());
  } catch {
    return null;
  }
}

/** Calls [onItem] for the share that opened the app and for each later one. */
export function watchShares(onItem: (item: SharedItem) => void): () => void {
  const n = integrationsNative();
  if (!n?.takeShared) return () => {};
  const check = () => {
    const item = take();
    if (item) onItem(item);
  };
  check();
  const sub = n.addListener?.('onShared', check);
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') check();
  });
  return () => {
    sub?.remove();
    app.remove();
  };
}

/**
 * Share into Sidekick from any app (Android ACTION_SEND, plugins/with-share-target.js →
 * PhoneExtras.noteIntent): text, links, pictures, PDFs, text documents and recordings; and text
 * selected in another app (PROCESS_TEXT, ProcessTextActivity.kt). A picture is shown as "Asking
 * about the shared picture"; a link, file or selection becomes the chat's attachment
 * (shared-doc.ts); other text goes in the composer.
 */
import { AppState } from 'react-native';

import { integrationsNative } from '@/integrations/native';
import { isJustLink } from './shared-doc-logic';

export type SharedItem = {
  text?: string;
  subject?: string;
  imagePath?: string;
  /** A shared file copied into the app cache, with its type and name. */
  filePath?: string;
  mime?: string;
  fileName?: string;
  /** A file that couldn't be copied in (too big or unreadable): its name. */
  fileError?: string;
  /** Text selected in another app, and whether that app can't take new text back. */
  selection?: string;
  readonly?: boolean;
  at: number;
};

export function parseShared(raw: string | null | undefined): SharedItem | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as SharedItem;
    if (
      !o ||
      (typeof o.text !== 'string' &&
        typeof o.imagePath !== 'string' &&
        typeof o.filePath !== 'string' &&
        typeof o.fileError !== 'string' &&
        typeof o.selection !== 'string')
    )
      return null;
    return o;
  } catch {
    return null;
  }
}

/** What a share is: decides where it goes in the chat. */
export function sharedKind(
  item: SharedItem,
): 'selection' | 'file' | 'file-error' | 'image' | 'link' | 'text' | null {
  if (typeof item.selection === 'string' && item.selection.trim()) return 'selection';
  if (item.filePath) return 'file';
  if (item.fileError) return 'file-error';
  if (item.imagePath) return 'image';
  const text = (item.text ?? '').trim();
  if (text && isJustLink(text, item.subject ?? '')) return 'link';
  return text || item.subject ? 'text' : null;
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

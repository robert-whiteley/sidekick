/**
 * The one confirmation for deleting data, memories, indexes or models (Settings buttons and the
 * app_setting tool alike): a sheet that says what is deleted, with counts and sizes, that it
 * can't be undone, offers Export first where it helps, and enables Delete only once DELETE is
 * typed. Never by voice, never by one tap. Pure state; the sheet is
 * features/settings/DeleteConfirmHost.tsx. Tested in __tests__/settings-approval-test.ts.
 */

/** The word typed to enable Delete (the app is English only). */
export const DELETE_WORD = 'DELETE';

export type DeleteRequest = {
  title: string;
  /** What is deleted, one line each, with counts and sizes where known. */
  lines: string[];
  /** Offer "Export everything first" (memories and media). */
  exportFirst?: boolean;
  run: () => Promise<void> | void;
  /** Called after it ran, or when cancelled (false). */
  onDone?: (deleted: boolean) => void;
};

/** True when [typed] is the confirmation word (any case, spaces around ignored). */
export function typedConfirms(typed: string, word = DELETE_WORD): boolean {
  return typed.trim().toUpperCase() === word;
}

let current: (DeleteRequest & { seq: number }) | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Opens the sheet (replacing one already open, which counts as cancelled). */
export function requestDelete(r: DeleteRequest) {
  const prev = current;
  current = { ...r, seq: ++seq };
  prev?.onDone?.(false);
  emit();
}

export const pendingDelete = () => current;

export function onDeleteRequest(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function cancelDelete() {
  const r = current;
  current = null;
  emit();
  r?.onDone?.(false);
}

/** Runs the deletion only when the word was typed; false (nothing deleted) otherwise. */
export async function confirmDelete(typed: string): Promise<boolean> {
  const r = current;
  if (!r || !typedConfirms(typed)) return false;
  current = null;
  emit();
  await r.run();
  r.onDone?.(true);
  return true;
}

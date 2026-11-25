/**
 * The chat screen's pure logic: messages, history rows, when to speak, mic tap vs hold.
 * Tested in __tests__/chat-logic-test.ts.
 */
import type { WebSource } from '@/web/lookup';

/** A stored moment shown in the chat (D2's MomentPlayer opens it at `momentAt`). */
export type ChatMedia = { momentAt: number; kind: 'video' | 'photo' | 'audio'; path?: string };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  /** Asked by voice (so the answer is spoken). */
  spoken?: boolean;
  web?: WebSource[];
  /** The question behind the browser link ('' = no link) and the search words used. */
  webAsk?: { question: string; query?: string };
  media?: ChatMedia[];
  /** A phone action waiting for OK (engine/actions.ts), shown as a card under the answer. */
  draftId?: string;
  /** Said while Off the record: shown now, never saved, gone when the mode is left. */
  offRecord?: boolean;
  /** The answer is still being written. */
  pending?: boolean;
};

/** How many past exchanges the chat shows when it opens. */
export const HISTORY_EXCHANGES = 30;

/** A press on the mic shorter than this is a tap: listen until tapped again. */
export const MIC_TAP_MS = 350;

/** A mic press that started at `startedAt` and ends now was a tap. */
export const isMicTap = (startedAt: number, now = Date.now()) => now - startedAt < MIC_TAP_MS;

const QA = /^Q: ([\s\S]*?)\nA: ([\s\S]*)$/;

/** One saved exchange ("Q: …\nA: …", kind 'answer' or 'photo') → the user and assistant bubbles. */
export function exchangeToMessages(row: {
  id: number;
  at: number;
  text: string;
  photoPath?: string | null;
}): ChatMessage[] {
  const m = QA.exec(row.text);
  if (!m) return [];
  const media: ChatMedia[] | undefined = row.photoPath
    ? [{ momentAt: row.at, kind: 'photo', path: row.photoPath }]
    : undefined;
  return [
    { id: `h${row.id}q`, role: 'user', text: m[1], at: row.at, media },
    { id: `h${row.id}a`, role: 'assistant', text: m[2], at: row.at },
  ];
}

/** Saved rows come newest first; the chat reads oldest first. */
export function historyToMessages(
  rows: { id: number; at: number; text: string; photoPath?: string | null }[],
): ChatMessage[] {
  return [...rows].sort((a, b) => a.at - b.at || a.id - b.id).flatMap(exchangeToMessages);
}

/**
 * Voice in, voice out: an answer is spoken when the question was spoken or headphones are on,
 * unless spoken answers are switched off in Settings.
 */
export function shouldSpeak(o: { spoken: boolean; headphones: boolean; enabled: boolean }) {
  return o.enabled && (o.spoken || o.headphones);
}

/** The stored moments an answer showed: the saved photo it re-read, plus any the engine gives. */
export function mediaForAnswer(r: {
  usedPhoto: string | null;
  sources: { at: number; photoPath: string | null }[];
  media?: ChatMedia[];
}): ChatMedia[] | undefined {
  const out: ChatMedia[] = [...(r.media ?? [])];
  if (r.usedPhoto && !out.some((m) => m.path === r.usedPhoto)) {
    const src = r.sources.find((s) => s.photoPath === r.usedPhoto);
    if (src) out.push({ momentAt: src.at, kind: 'photo', path: r.usedPhoto });
  }
  return out.length ? out : undefined;
}

/** Leaving Off the record: what was said in it disappears. */
export const withoutOffRecord = (msgs: ChatMessage[]) => msgs.filter((m) => !m.offRecord);

/** Replaces the message with `id` (no-op when it is gone). */
export const patchMessage = (msgs: ChatMessage[], id: string, patch: Partial<ChatMessage>) =>
  msgs.map((m) => (m.id === id ? { ...m, ...patch } : m));

/** Status line for the words heard so far: the last few words, so a long question still fits. */
export function partialStatus(text: string, maxWords = 14): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Listening…';
  const shown = words.length > maxWords ? `…${words.slice(-maxWords).join(' ')}` : words.join(' ');
  return `“${shown}…”`;
}

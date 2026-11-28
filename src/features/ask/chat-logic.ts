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
  /** Stop (or Send now) ended the answer: what was written is kept, marked as stopped. */
  stopped?: boolean;
  /** An answer about text selected in another app: Replace in the app / Copy / Share under it. */
  textResult?: boolean;
  /** The saved exchange this message belongs to (a model answer): Edit / Try again take it back. */
  momentId?: number;
  /** A picture Sidekick drew: its description, for the Report button under it. */
  picture?: { prompt: string };
  /** A button under the answer that opens a screen in the app (open: a found original). */
  link?: { label: string; href: string; open?: string };
};

/** The chat's last question and its answer, when Edit / Try again may replace them. */
export type Exchange = { question: ChatMessage; reply: ChatMessage };

/**
 * Edit and Try again work on the last exchange only, so the one continuous chat stays
 * consistent: a model answer that was saved (not a rule's reply, a draft or Off the record),
 * finished, to a question without a photo (the photo can't be taken again).
 */
export function lastExchange(msgs: ChatMessage[]): Exchange | null {
  const reply = msgs.at(-1);
  const question = msgs.at(-2);
  if (!reply || !question || reply.role !== 'assistant' || question.role !== 'user') return null;
  if (reply.pending || reply.momentId == null || reply.offRecord || reply.draftId) return null;
  if (question.media?.length || !question.text.trim()) return null;
  return { question, reply };
}

/** Removes an exchange's two bubbles (it is being asked again). */
export const withoutExchange = (msgs: ChatMessage[], x: Exchange) =>
  msgs.filter((m) => m.id !== x.question.id && m.id !== x.reply.id);

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
  kind?: string;
  text: string;
  photoPath?: string | null;
}): ChatMessage[] {
  const m = QA.exec(row.text);
  if (!m) return [];
  const media: ChatMedia[] | undefined = row.photoPath
    ? [{ momentAt: row.at, kind: 'photo', path: row.photoPath }]
    : undefined;
  // A picture Sidekick drew sits under its answer; a photo the user sent, with the question.
  if (row.kind === 'picture')
    return [
      { id: `h${row.id}q`, role: 'user', text: m[1], at: row.at, momentId: row.id },
      {
        id: `h${row.id}a`,
        role: 'assistant',
        text: m[2],
        at: row.at,
        // momentAt 0: a file of its own, so no camera frames from that time are shown with it.
        media: row.photoPath ? [{ momentAt: 0, kind: 'photo', path: row.photoPath }] : undefined,
        picture: { prompt: m[1] },
        momentId: row.id,
      },
    ];
  return [
    { id: `h${row.id}q`, role: 'user', text: m[1], at: row.at, media, momentId: row.id },
    { id: `h${row.id}a`, role: 'assistant', text: m[2], at: row.at, momentId: row.id },
  ];
}

/** Saved rows come newest first; the chat reads oldest first. */
export function historyToMessages(
  rows: { id: number; at: number; kind?: string; text: string; photoPath?: string | null }[],
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
export const withoutOffRecord = <T extends { offRecord?: boolean }>(msgs: T[]) =>
  msgs.filter((m) => !m.offRecord);

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

/**
 * Talking over an answer stops it; what is said next is the next question. If nothing comes
 * within this long (the words were cut off, too short or not heard), the chat says so.
 */
export const BARGE_WAIT_MS = 15_000;

export const NOT_HEARD_AFTER_BARGE =
  "I stopped to listen, but didn't catch what you said. Please say it again.";

/**
 * Nothing was heard after talking over the answer [replyId]: its empty bubble (stopped before a
 * word) gets the plain line; a part-answer is kept and the line follows it as its own message.
 */
export function quietAfterBargeIn(
  msgs: ChatMessage[],
  replyId: string | null,
  at: number,
): ChatMessage[] {
  const reply = replyId ? msgs.find((m) => m.id === replyId) : undefined;
  if (reply && !reply.text.trim())
    return patchMessage(msgs, reply.id, { text: NOT_HEARD_AFTER_BARGE, pending: false });
  return [...msgs, { id: `a${at}b`, role: 'assistant', text: NOT_HEARD_AFTER_BARGE, at }];
}

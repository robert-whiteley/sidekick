/**
 * Messages sent while Sidekick is still answering: they wait in order (shown as queued bubbles,
 * editable and removable until they start) and are answered in turn. "Send now" stops the
 * answer and puts the message first. Pure logic; tested in __tests__/send-queue-test.ts.
 */

export type QueuedMessage = {
  id: string;
  text: string;
  at: number;
  /** Said, not typed (its answer is spoken). */
  spoken: boolean;
  /** A spoken follow-up in a conversation. */
  followUp: boolean;
  /** Sent Off the record: dropped with the rest of it when the mode is left. */
  offRecord: boolean;
};

/** Adds a message at the end; empty text is not queued. */
export function enqueue(queue: QueuedMessage[], m: QueuedMessage): QueuedMessage[] {
  return m.text.trim() ? [...queue, { ...m, text: m.text.trim() }] : queue;
}

/** Takes a queued message out (Remove, or it started). */
export const withoutQueued = (queue: QueuedMessage[], id: string) =>
  queue.filter((m) => m.id !== id);

/** New text for a queued message, kept in its place; emptied, it is removed. */
export function editQueued(queue: QueuedMessage[], id: string, text: string): QueuedMessage[] {
  const t = text.trim();
  if (!t) return withoutQueued(queue, id);
  return queue.map((m) => (m.id === id ? { ...m, text: t } : m));
}

/** Send now: the message goes first (the others keep their order). */
export function toFront(queue: QueuedMessage[], id: string): QueuedMessage[] {
  const m = queue.find((x) => x.id === id);
  return m ? [m, ...withoutQueued(queue, id)] : queue;
}

/** The message to answer next, and the queue without it. One being edited (`held`) waits. */
export function takeNext(
  queue: QueuedMessage[],
  held: string | null = null,
): { next: QueuedMessage | null; rest: QueuedMessage[] } {
  const next = queue.find((m) => m.id !== held) ?? null;
  return { next, rest: next ? withoutQueued(queue, next.id) : queue };
}

/** How the answer that just ended was stopped: Stop, or Send now on another message. */
export type StopReason = 'stop' | 'now' | null;

/**
 * The questions still owed an answer after one ends. Send now on a question that got no words
 * yet: it is carried to the next answer, which answers both. Plain Stop means "not that one".
 */
export function unansweredAfter(
  owed: string[],
  ended: { question: string; text: string; stopped: StopReason },
): string[] {
  if (ended.stopped === 'now' && !ended.text.trim()) return [...owed, ended.question];
  return [];
}

/** What the model is asked: the questions still owed an answer, then the new one. */
export const withOwed = (owed: string[], question: string) => [...owed, question].join('\n\n');

/**
 * Reading the listening journal safely (MicLoop.kt Journal.take / ack). Lines stay on the phone
 * until they are saved, so a kill or a failed database write mid-way never loses what was heard.
 * Pure logic plus a thin wrapper over the native calls; tested.
 */

export type JournalNative = {
  journalDrain(): string[];
  journalTake?(): { lines: string[]; replayed: number };
  journalAck?(): void;
};

export type Take = {
  lines: string[];
  /** > 0: some lines may have been handed out (and saved) before; skip ones already in memory. */
  replayed: number;
  /** Marks the batch saved. */
  ack: () => void;
};

/** The next batch; builds without Journal.take fall back to the old read-and-clear drain. */
export function takeJournal(n: JournalNative): Take {
  if (n.journalTake && n.journalAck) {
    const t = n.journalTake();
    return { lines: t.lines, replayed: t.replayed, ack: () => n.journalAck!() };
  }
  return { lines: n.journalDrain(), replayed: 0, ack: () => {} };
}

/** Tries before a batch that keeps failing is let go (a line that can never be saved must not block the rest forever). */
export const MAX_TAKE_TRIES = 3;

/** Whether to ack a batch: always when it all saved; after [MAX_TAKE_TRIES] failed tries anyway. */
export class AckPolicy {
  private failures = 0;

  done(anyFailed: boolean): boolean {
    if (!anyFailed) {
      this.failures = 0;
      return true;
    }
    this.failures++;
    if (this.failures >= MAX_TAKE_TRIES) {
      this.failures = 0;
      return true;
    }
    return false;
  }
}

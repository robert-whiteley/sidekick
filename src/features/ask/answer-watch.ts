/**
 * No answer may sit on one line with no sign of life. While a step is slow (the model loading or
 * reading a picture on the iPhone's CPU), its status line counts the seconds; when nothing at all
 * has happened for STALL_MS (no new step, no words), the chat stops waiting and says so plainly.
 * Pure logic; AskScreen runs the clock. Tested in __tests__/answer-watch-test.ts.
 */

/** A step's line shows its seconds once it has taken this long. */
export const SHOW_SECONDS_AFTER_MS = 5_000;
/** Nothing new for this long (no step, no words): stop waiting. */
export const STALL_MS = 120_000;

export const STALLED_TEXT =
  'Sorry, that took too long on this phone, so I stopped. Please try again.';
export const STALLED_PHOTO_TEXT =
  'Sorry, looking at the picture took too long on this phone, so I stopped. Please try again, or ask about the text in it.';

/** "Reading the picture… 12 s" once a step is slow; the plain line before that. */
export function progressLine(status: string, stepMs: number): string {
  if (!status || stepMs < SHOW_SECONDS_AFTER_MS) return status;
  return `${status} ${Math.floor(stepMs / 1000)} s`;
}

/** The clock of one answer: when its current step began and when anything last happened. */
export class AnswerWatch {
  status = '';
  private stepAt: number;
  private lastAt: number;
  private done = false;

  constructor(now: number) {
    this.stepAt = now;
    this.lastAt = now;
  }

  /** A new step's line ("Searching memory…"). */
  step(status: string, now: number) {
    if (status !== this.status) this.stepAt = now;
    this.status = status;
    this.lastAt = now;
  }

  /** Words of the answer arrived (or a picture step moved on). */
  alive(now: number) {
    this.lastAt = now;
  }

  /** The answer finished or was stopped: the clock no longer matters. */
  finish() {
    this.done = true;
  }

  line(now: number): string {
    return progressLine(this.status, now - this.stepAt);
  }

  stalled(now: number): boolean {
    return !this.done && now - this.lastAt >= STALL_MS;
  }
}

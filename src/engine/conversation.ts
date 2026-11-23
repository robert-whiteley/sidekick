/** How long after Sidekick stops talking a new question still continues the chat (matches Turns.kt). */
export const FOLLOW_UP_MS = 8000;

/**
 * Decides whether a question continues the current chat (model keeps the earlier turns) or starts
 * fresh. It continues when the mic heard it as a follow-up (said over or right after an answer),
 * or when it is asked by hand within the follow-up window. Asking about something new later
 * starts a fresh chat, so old turns don't slow down or confuse unrelated answers.
 */
export class Conversation {
  private lastSpokeAt = -Infinity;
  private turns = 0;

  /** Sidekick finished or was stopped (Voice idle), or an unspoken answer was shown. */
  answered(now: number) {
    this.lastSpokeAt = now;
    this.turns++;
  }

  keepHistory(heardAsFollowUp: boolean, now: number): boolean {
    if (this.turns === 0) return false;
    return heardAsFollowUp || now - this.lastSpokeAt <= FOLLOW_UP_MS;
  }

  reset() {
    this.turns = 0;
    this.lastSpokeAt = -Infinity;
  }
}

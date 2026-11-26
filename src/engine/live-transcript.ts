/**
 * The conversation as it is heard, for the Ask screen. Lines come from the memory ingest (with
 * the speaker's voice and whether the line was kept) or, when a line was not journaled (e.g.
 * conversation recording off), straight from the transcript event with no speaker. Held in
 * memory only; nothing here is saved. Pure state; tested.
 */

export type LiveLine = {
  /** When the speech started (ms); also the key shared by the event and the journal entry. */
  at: number;
  text: string;
  speakerId: number | null;
  isOwner: boolean;
  /** False when it was not kept in memory (consent not given yet, or recording off). */
  saved: boolean;
};

export const MAX_LIVE_LINES = 200;
/** A transcript event waits this long for its journal entry before it is shown on its own. */
export const ORPHAN_WAIT_MS = 1500;

export class LiveTranscript {
  private lines: LiveLine[] = [];
  private listeners = new Set<(lines: LiveLine[]) => void>();

  get all(): LiveLine[] {
    return this.lines;
  }

  /** Adds or updates (same `at`) a line; keeps time order and the newest MAX_LIVE_LINES. */
  put(line: LiveLine) {
    const i = this.lines.findIndex((l) => l.at === line.at);
    const next = [...this.lines];
    if (i >= 0) {
      // A journal entry replaces an event-only line, never the other way round.
      if (next[i].speakerId != null && line.speakerId == null) return;
      next[i] = line;
    } else {
      next.push(line);
      next.sort((a, b) => a.at - b.at);
    }
    this.lines = next.slice(-MAX_LIVE_LINES);
    this.listeners.forEach((l) => l(this.lines));
  }

  /** Gives an unattributed line its voice once that voice becomes known. */
  relabel(at: number, speakerId: number) {
    const i = this.lines.findIndex((l) => l.at === at && l.speakerId == null);
    if (i < 0) return;
    this.lines = this.lines.map((l, j) => (j === i ? { ...l, speakerId } : l));
    this.listeners.forEach((l) => l(this.lines));
  }

  /** Moves every line of one voice to another id (an unsaved voice that was just stored). */
  respeak(fromId: number, toId: number) {
    if (!this.lines.some((l) => l.speakerId === fromId)) return;
    this.lines = this.lines.map((l) => (l.speakerId === fromId ? { ...l, speakerId: toId } : l));
    this.listeners.forEach((l) => l(this.lines));
  }

  /** Replaces a line's text (an English translation added under it). */
  retext(at: number, text: string) {
    const i = this.lines.findIndex((l) => l.at === at);
    if (i < 0) return;
    this.lines = this.lines.map((l, j) => (j === i ? { ...l, text } : l));
    this.listeners.forEach((l) => l(this.lines));
  }

  has(at: number): boolean {
    return this.lines.some((l) => l.at === at);
  }

  clear() {
    this.lines = [];
    this.listeners.forEach((l) => l(this.lines));
  }

  subscribe(l: (lines: LiveLine[]) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

/** The one transcript for this app session. */
export const liveTranscript = new LiveTranscript();

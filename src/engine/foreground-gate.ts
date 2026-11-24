/**
 * Background model passes wait while the owner is being answered: an answer is being written or
 * spoken. Sharing the CPU with a background pass made the first spoken word come late. A safety
 * timeout means a missed "done" can never hold background work up for good.
 */
export const FOREGROUND_MAX_MS = 3 * 60_000;

export class ForegroundGate {
  private until = 0;
  private waiters: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly maxMs = FOREGROUND_MAX_MS,
    private readonly now = () => Date.now(),
  ) {}

  get busy(): boolean {
    return this.now() < this.until;
  }

  /** An answer has started (or is still going): hold background passes. */
  hold() {
    this.until = this.now() + this.maxMs;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.release(), this.maxMs);
  }

  /** The answer is over (written and spoken, failed or stopped). */
  release() {
    this.until = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  /** Resolves at once when nothing is being answered, else when the answer is over. */
  idle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }
}

/**
 * One model, one job at a time. Background jobs (fact, follow-up and photo-description passes) wait
 * their turn; a user's question goes ahead of every waiting background job and stops a running one
 * (via [preempt]). Without this, background jobs started together kept cancelling each other and
 * none ever finished. Pure logic; tested.
 */
type Job = { background: boolean; start: () => void };

/** How often a waiting question re-sends the stop: one sent before the job reached the model is lost. */
export const PREEMPT_RETRY_MS = 250;

export class LlmQueue {
  private running: { background: boolean } | null = null;
  private retry: ReturnType<typeof setInterval> | null = null;
  private waiting: Job[] = [];
  /** Background jobs stopped for a question so far (a stopped job's reply is cut short). */
  preemptions = 0;

  constructor(private preempt: () => void) {}

  get busy(): boolean {
    return this.running !== null;
  }

  async run<T>(background: boolean, fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((start) => {
      const job = { background, start };
      if (background) this.waiting.push(job);
      else {
        // After any other waiting user jobs, before every background job.
        const firstBg = this.waiting.findIndex((j) => j.background);
        this.waiting.splice(firstBg < 0 ? this.waiting.length : firstBg, 0, job);
        if (this.running?.background) {
          this.preemptions++;
          this.stopBackground();
        }
      }
      this.next();
    });
    try {
      return await fn();
    } finally {
      this.running = null;
      this.next();
    }
  }

  /** Stops the running background job, again and again until it has ended. */
  private stopBackground() {
    this.preempt();
    if (this.retry) return;
    const job = this.running;
    this.retry = setInterval(() => {
      if (this.running === job) this.preempt();
      else this.clearRetry();
    }, PREEMPT_RETRY_MS);
  }

  private clearRetry() {
    if (this.retry) clearInterval(this.retry);
    this.retry = null;
  }

  private next() {
    if (this.running) return;
    this.clearRetry();
    const job = this.waiting.shift();
    if (!job) return;
    this.running = { background: job.background };
    job.start();
  }
}

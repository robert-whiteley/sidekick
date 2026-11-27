/**
 * Polite requests without identifying anyone. Wikimedia allows a client that sends no contact
 * details 10 requests a minute per IP (2026 limits); the app's User-Agent names only the app, so
 * every phone keeps under that with one shared per-minute window for all Wikimedia requests
 * (quick lookups and research alike). Any server's "too many requests" (429, or 503 with
 * Retry-After) gets one wait-and-retry when the wait fits the request's time limit. Tested in
 * __tests__/rate-limit-test.ts.
 */

/** One under Wikimedia's 10 a minute, to leave room for clock drift between phone and server. */
export const WIKIMEDIA_PER_MIN = 9;
export const RATE_WINDOW_MS = 60_000;
/** Wait used after a 429 without a Retry-After header. */
export const DEFAULT_RETRY_MS = 2000;

export function isWikimedia(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)(wikipedia|wikimedia|wikidata|mediawiki|wiktionary|wikinews|wikivoyage)\.org$/.test(
      host,
    );
  } catch {
    return false;
  }
}

/** At most [limit] requests in any [windowMs]. */
export class RateWindow {
  private times: number[] = [];
  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private clock: () => number = Date.now,
  ) {}
  private prune() {
    const since = this.clock() - this.windowMs;
    this.times = this.times.filter((t) => t > since);
  }
  /** Requests still allowed right now. */
  left(): number {
    this.prune();
    return Math.max(0, this.limit - this.times.length);
  }
  /** How long until the next request is allowed (0 = now). */
  waitMs(): number {
    this.prune();
    if (this.times.length < this.limit) return 0;
    return Math.max(0, this.times[this.times.length - this.limit] + this.windowMs - this.clock());
  }
  /** How long until [n] requests in a row are allowed (0 = now). */
  waitForMs(n: number): number {
    this.prune();
    const over = this.times.length - Math.max(0, this.limit - n);
    if (over <= 0) return 0;
    return Math.max(0, this.times[over - 1] + this.windowMs - this.clock());
  }
  take() {
    this.times.push(this.clock());
  }
  reset() {
    this.times = [];
  }
}

/** The one window every Wikimedia request on this phone goes through. */
export const wikimedia = new RateWindow(WIKIMEDIA_PER_MIN, RATE_WINDOW_MS);

/** Retry-After as milliseconds: seconds ("5") or an HTTP date. Null when missing or unreadable. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const s = header.trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type PoliteOptions = {
  /** Give up (null) rather than wait past this time (ms since epoch). */
  deadline: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  window?: RateWindow;
};

/**
 * [doFetch] with the Wikimedia window and one retry after "too many requests". Null when the
 * request would have to wait past [deadline] (the caller treats it as no result).
 */
export async function politeFetch(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  opts: PoliteOptions,
): Promise<Response | null> {
  const sleep = opts.sleep ?? realSleep;
  const clock = opts.clock ?? Date.now;
  const win = isWikimedia(url) ? (opts.window ?? wikimedia) : null;
  const turn = async () => {
    if (!win) return true;
    const w = win.waitMs();
    if (clock() + w > opts.deadline) return false;
    if (w) await sleep(w);
    win.take();
    return true;
  };
  // Other sites go straight out (no await first, so the caller's timeout covers the request).
  if (win && !(await turn())) return null;
  const res = await doFetch(url, init);
  const busy = res.status === 429 || (res.status === 503 && !!res.headers?.get?.('retry-after'));
  if (!busy) return res;
  const wait = retryAfterMs(res.headers?.get?.('retry-after'), clock()) ?? DEFAULT_RETRY_MS;
  if (clock() + wait > opts.deadline) return res;
  await sleep(wait);
  if (!(await turn())) return res;
  return doFetch(url, init);
}

/**
 * Questions that need the internet, asked while offline: kept and answered when the phone is
 * back online (online-queue.ts). Pure logic, tested.
 */

export type OnlineJobKind = 'lookup' | 'weather' | 'page';

export type OnlineJob = {
  id: string;
  kind: OnlineJobKind;
  question: string;
  askedAt: number;
  /** 'page': the web page to read (a shared or pasted link). */
  url?: string;
};

/** A forecast asked for hours ago is stale; a general question keeps for a few days. */
const KEEP_MS: Record<OnlineJobKind, number> = {
  weather: 6 * 60 * 60_000,
  lookup: 3 * 24 * 60 * 60_000,
  page: 3 * 24 * 60 * 60_000,
};

/** At most this many wait (oldest dropped first). */
export const MAX_ONLINE_JOBS = 20;

export function jobExpired(j: OnlineJob, now: number): boolean {
  return now - j.askedAt > KEEP_MS[j.kind];
}

const norm = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Adds [job] unless the same question is already waiting; keeps the newest MAX_ONLINE_JOBS. */
export function addJob(jobs: OnlineJob[], job: OnlineJob): OnlineJob[] {
  if (jobs.some((j) => norm(j.question) === norm(job.question) && j.url === job.url)) return jobs;
  return [...jobs, job].slice(-MAX_ONLINE_JOBS);
}

/** What Sidekick says when it queues one. */
export function queuedLine(kind: OnlineJobKind): string {
  if (kind === 'page') return "I'll read the page as soon as Sidekick is online.";
  return kind === 'weather'
    ? "There's no internet right now. I'll get the forecast as soon as you're back online."
    : "I'll look that up online as soon as you're back online.";
}

function clock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Title of the answer when it arrives ("You asked at 14:05: who won the match?"). */
export function answeredTitle(j: OnlineJob, now: number): string {
  const sameDay = new Date(j.askedAt).toDateString() === new Date(now).toDateString();
  const when = sameDay ? `at ${clock(j.askedAt)}` : new Date(j.askedAt).toDateString().slice(0, 10);
  const q = j.question.length > 80 ? `${j.question.slice(0, 77)}…` : j.question;
  return `You asked ${when}: ${q}`;
}

// --- Network routines ---

export type NetState = { online: boolean; wifi: boolean };
export type NetEdge = 'online' | 'offline' | 'wifi' | 'wifi-leave';

/** What changed between two network states (none for the first one seen). */
export function networkEdges(prev: NetState | null, cur: NetState): NetEdge[] {
  if (!prev) return [];
  const out: NetEdge[] = [];
  if (!prev.online && cur.online) out.push('online');
  if (prev.online && !cur.online) out.push('offline');
  if (!prev.wifi && cur.wifi) out.push('wifi');
  if (prev.wifi && !cur.wifi) out.push('wifi-leave');
  return out;
}

/** What the native side waits for (Offline.kt): queued work and which network routines exist. */
export function nativeConfig(pending: number, edges: NetEdge[]) {
  return {
    pending,
    online: edges.includes('online'),
    wifi: edges.includes('wifi'),
    offline: edges.includes('offline'),
    wifiLeave: edges.includes('wifi-leave'),
  };
}

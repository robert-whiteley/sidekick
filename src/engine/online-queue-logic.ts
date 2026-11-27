/**
 * Work that needs the internet, asked for while offline: kept and done when the phone is back
 * online (online-queue.ts). Pure logic, tested.
 */

/**
 * lookup / weather / page / research: answered then. navigate: directions to a place Sidekick
 * can't place offline; once online, Maps finds it (it searches the place itself), started at once
 * if it was asked for a few minutes ago and Sidekick is on screen, else offered with a tap.
 */
export type OnlineJobKind = 'lookup' | 'weather' | 'page' | 'research' | 'navigate';

export type TravelMode = 'driving' | 'walking' | 'transit' | 'cycling';

export type OnlineJob = {
  id: string;
  kind: OnlineJobKind;
  /** The request; research: the topic; navigate: the destination. */
  question: string;
  askedAt: number;
  /** 'page': the web page to read (a shared or pasted link). */
  url?: string;
  /** 'research': about recent news. */
  news?: boolean;
  /** 'navigate': how to travel. */
  mode?: TravelMode;
  /** 'navigate': back online, waiting for the user's tap to start (no more network wake-ups). */
  readyAt?: number;
};

/**
 * How long each kind keeps. A forecast asked for hours ago is stale; directions are for now, so
 * they keep 3 hours (and start by themselves only within [NAV_AUTO_START_MS]); questions and
 * research keep a few days.
 */
const KEEP_MS: Record<OnlineJobKind, number> = {
  weather: 6 * 60 * 60_000,
  lookup: 3 * 24 * 60 * 60_000,
  page: 3 * 24 * 60 * 60_000,
  research: 3 * 24 * 60 * 60_000,
  navigate: 3 * 60 * 60_000,
};

/** Directions asked for at most this long ago start by themselves (Sidekick on screen). */
export const NAV_AUTO_START_MS = 15 * 60_000;

/**
 * What each catalog tool (tools-logic.ts) needs from the internet:
 * - offline: works without it;
 * - app: hands over to another app, which deals with its own connection (a chat app sends once
 *   online, a ride app needs it to order; ordering a taxi later by itself would be wrong);
 * - partly: what can start offline starts now, the rest waits here (navigate: a saved place or a
 *   town starts Maps at once, which navigates with offline maps; location: street names only);
 * - queue: waits here (or in its own outbox) and runs once online.
 * Outside the catalog: a question that needs an online lookup and a pasted link wait here; model
 * downloads wait in Android's download manager; Tasks sync and Drive backups run on reconnect.
 */
export type NetNeed = 'offline' | 'app' | 'partly' | 'queue';
export const TOOL_NET: Record<string, NetNeed> = {
  edit_photo: 'offline',
  make_picture: 'offline',
  memory_search: 'offline',
  find_on_phone: 'offline',
  recap: 'offline',
  research: 'queue',
  message: 'app', // SMS works offline; chat apps send once they are online
  email: 'queue', // the outbox (actions.ts flushOutbox)
  call: 'offline',
  draft: 'offline',
  reply_message: 'app',
  read_messages: 'offline',
  clipboard: 'offline',
  move_event: 'offline', // the calendar syncs by itself
  texts: 'offline',
  calls: 'offline',
  call_back: 'offline',
  event: 'offline',
  reminder: 'offline',
  routine: 'offline',
  alarm: 'offline',
  timer: 'offline',
  navigate: 'partly',
  ride: 'app',
  app_search: 'app',
  play: 'app',
  media: 'offline',
  open_app: 'offline',
  phone_setting: 'offline',
  phone_info: 'offline',
  birthdays: 'offline',
  weather: 'queue',
  location: 'partly',
  name_place: 'offline',
  watch: 'offline',
  stop_watching: 'offline',
  find_phone: 'offline',
  speech_speed: 'offline',
  listening: 'offline',
  camera: 'offline',
  camera_setting: 'offline',
  missed: 'offline',
  feedback: 'queue', // an email: the outbox
  calculate: 'offline',
  convert: 'offline',
  date: 'offline',
  time_in: 'offline',
  remember: 'offline',
  translate: 'offline',
  repeat: 'offline',
  help: 'offline',
  scan: 'offline',
  list_watches: 'offline',
  contact_number: 'offline',
  play_recording: 'offline',
};

/** At most this many wait (oldest dropped first). */
export const MAX_ONLINE_JOBS = 20;

export function jobExpired(j: OnlineJob, now: number): boolean {
  return now - j.askedAt > (KEEP_MS[j.kind] ?? KEEP_MS.lookup);
}

/** Still needs the internet (ready directions only wait for a tap). */
export const jobWaiting = (j: OnlineJob) => !j.readyAt;

/** Ready directions start by themselves only when asked for a few minutes ago. */
export function navAutoStart(j: OnlineJob, now: number): boolean {
  return j.kind === 'navigate' && now - j.askedAt <= NAV_AUTO_START_MS;
}

const norm = (q: string) =>
  q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Adds [job] unless the same request is already waiting; keeps the newest MAX_ONLINE_JOBS. */
export function addJob(jobs: OnlineJob[], job: OnlineJob): OnlineJob[] {
  const same = (j: OnlineJob) =>
    j.kind === job.kind && norm(j.question) === norm(job.question) && j.url === job.url;
  // Directions asked for again: the newer request (and its travel mode) replaces the older one.
  if (job.kind === 'navigate')
    return [...jobs.filter((j) => !same(j)), job].slice(-MAX_ONLINE_JOBS);
  if (jobs.some(same)) return jobs;
  return [...jobs, job].slice(-MAX_ONLINE_JOBS);
}

/** What Sidekick says when it queues one. */
export function queuedLine(kind: OnlineJobKind): string {
  if (kind === 'page') return "I'll read the page as soon as Sidekick is online.";
  if (kind === 'research')
    return "There's no internet right now. I'll do this research when you're back online.";
  if (kind === 'navigate')
    return "There's no internet right now. I'll start directions when you're back online.";
  return kind === 'weather'
    ? "There's no internet right now. I'll get the forecast as soon as you're back online."
    : "I'll look that up online as soon as you're back online.";
}

const short = (q: string) => (q.length > 80 ? `${q.slice(0, 77)}…` : q);

/** The chat card for a job still waiting (with Cancel; directions also with Open Maps now). */
export function waitingCard(j: OnlineJob): string {
  const q = short(j.question);
  if (j.kind === 'navigate')
    return `Waiting for the internet: directions to ${q}. With offline maps of the area, Maps can start now.`;
  if (j.kind === 'research') return `Waiting for the internet: research on ${q}`;
  return `Waiting for the internet: ${q}`;
}

/** Directions back online that wait for a tap (card and notification). */
export function navReadyLine(j: OnlineJob): { title: string; body: string } {
  return {
    title: `Directions to ${short(j.question)} are ready`,
    body: 'You asked while offline. Tap to start them in Maps.',
  };
}

function clock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Title of the answer when it arrives ("You asked at 14:05: who won the match?"). */
export function answeredTitle(j: OnlineJob, now: number): string {
  const sameDay = new Date(j.askedAt).toDateString() === new Date(now).toDateString();
  const when = sameDay ? `at ${clock(j.askedAt)}` : new Date(j.askedAt).toDateString().slice(0, 10);
  return `You asked ${when}: ${short(j.question)}`;
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

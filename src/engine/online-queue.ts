/**
 * Work that waits for the internet, done when the phone is back online, also with the app closed:
 * - questions that needed an online lookup, the weather, a pasted link or research, asked while
 *   offline: answered then, shown in the chat (a card now, and in the chat history) and as a
 *   notification;
 * - directions to a place Sidekick can't place offline (a saved place or a town starts Maps at
 *   once instead, which navigates with offline maps): back online, Maps finds the place. Android
 *   doesn't let an app open another app from the background, so they start by themselves only
 *   when asked for a few minutes ago and Sidekick is on screen; otherwise a card and a
 *   notification wait for a tap (kept 3 hours);
 * - emails waiting in the outbox, Google Tasks sync and a due Drive backup (their own modules);
 * - network routines ("when I'm back online / on Wi-Fi …", routines.ts).
 * Each waiting item has a chat card with Cancel. Model downloads need nothing here: Android's
 * download manager waits for Wi-Fi by itself.
 *
 * Android wakes JS through the "SidekickRoutine" task with {type:"network"} (Offline.kt:
 * WorkManager jobs with a network constraint, a 15-minute check, and a live network callback).
 * iPhone: no background wake-up (ADR 0006); the queue runs while Sidekick is open, when the
 * connection comes back or the app comes to the front. Logic: online-queue-logic.ts.
 */
import { AppState, Platform } from 'react-native';

import {
  addJob,
  answeredTitle,
  jobExpired,
  jobWaiting,
  type NetEdge,
  type NetState,
  nativeConfig,
  navAutoStart,
  navReadyLine,
  networkEdges,
  type OnlineJob,
  type OnlineJobKind,
  queuedLine,
  type TravelMode,
  waitingCard,
} from './online-queue-logic';
import { notices } from './notices';

type Native = {
  configure(json: string): void;
  markSent(online: boolean, wifi: boolean): void;
  state(): NetState;
};

let native: Native | null | undefined;
function nat(): Native | null {
  if (native !== undefined) return native;
  native = null;
  if (Platform.OS !== 'android') return native;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo');
    native = requireOptionalNativeModule('SidekickOffline') as Native | null;
  } catch {
    native = null;
  }
  return native;
}

type Deps = {
  load: () => OnlineJob[];
  save: (jobs: OnlineJob[]) => void;
  online: () => Promise<boolean>;
  answer: (question: string, job?: OnlineJob) => Promise<string>;
  remember: (question: string, answer: string) => Promise<void>;
  notify: (title: string, body: string, jobId?: string) => Promise<void>;
  active: () => boolean;
  afterOnline: () => Promise<void>;
  wantedEdges: () => NetEdge[];
  lastState: () => NetState | null;
  setLastState: (s: NetState) => void;
  /** Hands directions to Maps (only with Sidekick on screen); what to say, or null if it failed. */
  startNav: (destination: string, mode: TravelMode) => Promise<string | null>;
  /** Where a place is without the internet (named place, home, town), or null. */
  offlinePlace: (name: string) => Promise<{ name: string; lat: number; lon: number } | null>;
};

const KV_JOBS = 'online-queue.v1';
const KV_NET = 'online-queue.net';
const TAG = 'sidekick-online';

/* eslint-disable @typescript-eslint/no-require-imports */
function defaultDeps(): Deps {
  const kv = () => require('../../modules/sidekick-native').default;
  const read = <T>(k: string, d: T): T => {
    try {
      const v = kv().kvGet(k) as string | null;
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  };
  const write = (k: string, v: unknown) => {
    try {
      kv().kvSet(k, JSON.stringify(v));
    } catch {}
  };
  return {
    load: () => read<OnlineJob[]>(KV_JOBS, []),
    save: (jobs) => write(KV_JOBS, jobs),
    online: async () => {
      const s = nat()?.state();
      if (s) return s.online;
      return require('@/web/lookup').isOnline();
    },
    answer: async (q, job) => {
      // A shared or pasted link: read that page now (throws while still offline).
      if (job?.kind === 'page' && job.url)
        return (await require('./shared-doc').answerPageNow(job.url, q)) as string;
      if (job?.kind === 'research') {
        const { research } = require('@/web/research') as typeof import('@/web/research');
        const r = await research(q, () => {}, undefined, undefined, !!job.news);
        if (r.offline) throw new Error('still offline');
        return r.text;
      }
      const { answer } = require('./assistant');
      // Saved once, by the run (drainOnlineQueue), like every other kind.
      const r = await answer(q, null, () => {}, {
        routine: true,
        forceLookup: true,
        callerSaves: true,
      });
      // Android says online but nothing gets through yet: keep the question for the next wake-up.
      if (r.waitingOnline) throw new Error('still offline');
      return r.text as string;
    },
    remember: (q, a) => require('@/memory/store').rememberExchange(q, a),
    notify: async (title, body, jobId) => {
      const Notifications = require('expo-notifications');
      if (!(await Notifications.getPermissionsAsync()).granted) return;
      await Notifications.setNotificationChannelAsync('online', {
        name: 'Answers when back online',
        importance: Notifications.AndroidImportance.DEFAULT,
        // Contents hidden on a secure lock screen (answers can be personal).
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { tag: TAG, ...(jobId ? { job: jobId } : {}) } },
        trigger: { channelId: 'online' },
      });
    },
    active: () => AppState.currentState === 'active',
    afterOnline: async () => {
      await require('./actions')
        .flushOutbox()
        .catch(() => {});
      await require('@/integrations/google-tasks')
        .syncGoogleTasks()
        .catch(() => {});
      await require('./drive-backup-schedule')
        .driveBackupIfDue()
        .catch(() => {});
    },
    wantedEdges: () => {
      try {
        const { listRoutines } = require('./routines-store');
        return (listRoutines() as { paused?: boolean; when: { type: string; edge?: NetEdge } }[])
          .filter((r) => !r.paused && r.when.type === 'network')
          .map((r) => r.when.edge as NetEdge);
      } catch {
        return [];
      }
    },
    lastState: () => read<NetState | null>(KV_NET, null),
    setLastState: (s) => write(KV_NET, s),
    startNav: async (destination, mode) => {
      if (!require('@/integrations/prefs').isOn('maps', 'navigate')) return null;
      const n = require('@/integrations/native').integrationsNative();
      return n?.navigate(destination, mode) ? `Opening directions to ${destination}.` : null;
    },
    offlinePlace: (name) => require('./location').offlinePlace(name),
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */

let deps: Deps | null = null;
const d = () => (deps ??= defaultDeps());

/** Tests. */
export function setOnlineQueueDeps(p: Partial<Deps> | null) {
  deps = p ? { ...defaultDeps(), ...p } : null;
}

const cardKey = (id: string) => `online:${id}`;
const drop = (id: string) =>
  d().save(
    d()
      .load()
      .filter((x) => x.id !== id),
  );

/** Tells native what is waiting and which network routines exist (plans its wake-ups). */
export function syncOnlineNative() {
  try {
    const waiting = d().load().filter(jobWaiting).length;
    nat()?.configure(JSON.stringify(nativeConfig(waiting, d().wantedEdges())));
  } catch (e) {
    console.log(`[online] configure: ${String(e)}`);
  }
}

/** Takes a waiting item back (its card's Cancel). */
export function cancelOnline(id: string) {
  drop(id);
  notices.dismiss(cardKey(id));
  syncOnlineNative();
}

/** The chat card of a job still waiting: Cancel, and for directions Open Maps now. */
function postWaiting(j: OnlineJob) {
  notices.post(
    {
      key: cardKey(j.id),
      kind: 'decision',
      text: waitingCard(j),
      severity: 0,
      at: j.askedAt,
      actions: [
        ...(j.kind === 'navigate' ? [{ label: 'Open Maps now', id: 'start' }] : []),
        { label: 'Cancel', id: 'cancel' },
      ],
    },
    (a) => {
      if (a === 'cancel') cancelOnline(j.id);
      else if (a === 'start') void startDirections(j.id);
    },
  );
}

/** Directions back online, waiting for a tap. */
function postReady(j: OnlineJob) {
  const { title } = navReadyLine(j);
  notices.post(
    {
      key: cardKey(j.id),
      kind: 'decision',
      text: title,
      severity: 1,
      actions: [
        { label: 'Start directions', id: 'start' },
        { label: 'Cancel', id: 'cancel' },
      ],
    },
    (a) => {
      if (a === 'cancel') cancelOnline(j.id);
      else void startDirections(j.id);
    },
  );
}

/**
 * Starts the waiting directions [id] in Maps (a tap on its card or notification, so Sidekick is
 * on screen). Done or not, the item leaves the queue; a failure is said in the chat.
 */
export async function startDirections(id: string): Promise<void> {
  const j = d()
    .load()
    .find((x) => x.id === id);
  notices.dismiss(cardKey(id));
  if (!j || j.kind !== 'navigate') return;
  drop(id);
  syncOnlineNative();
  const said = await d()
    .startNav(j.question, j.mode ?? 'driving')
    .catch(() => null);
  notices.post({
    key: `online-done:${id}`,
    kind: 'info',
    text: said ?? `I couldn't open directions to ${j.question}.`,
  });
}

/** Keeps [question] for when the phone is back online; returns the line to say now. */
export function queueOnline(
  kind: OnlineJobKind,
  question: string,
  now = Date.now(),
  url?: string,
  more: { news?: boolean; mode?: TravelMode } = {},
): string {
  const jobs = d().load();
  const job: OnlineJob = {
    id: `oq${now}`,
    kind,
    question,
    askedAt: now,
    ...(url ? { url } : {}),
    ...(more.news ? { news: true } : {}),
    ...(more.mode ? { mode: more.mode } : {}),
  };
  const next = addJob(jobs, job);
  d().save(next);
  if (next.some((j) => j.id === job.id)) {
    // The same directions asked again: only the newer one waits.
    for (const old of jobs) if (!next.includes(old)) notices.dismiss(cardKey(old.id));
    postWaiting(job);
  }
  syncOnlineNative();
  return queuedLine(kind);
}

/**
 * "Navigate to …" while offline: a place Sidekick knows without the internet (a named place,
 * home, a town) goes to Maps now as coordinates, which it navigates with offline maps; anything
 * else waits for the internet, with Open Maps now on its card (Maps may find it offline). Null
 * when online (the usual path).
 */
export async function navigateOffline(
  destination: string,
  mode: TravelMode,
  now = Date.now(),
): Promise<string | null> {
  if (await d().online()) return null;
  const known = await d()
    .offlinePlace(destination)
    .catch(() => null);
  if (known) {
    const said = await d()
      .startNav(`${known.lat},${known.lon}`, mode)
      .catch(() => null);
    if (said)
      return `Opening directions to ${known.name}. You're offline, so Maps needs offline maps of the area.`;
  }
  return queueOnline('navigate', destination, now, undefined, { mode });
}

export function pendingOnline(): OnlineJob[] {
  return d().load();
}

let draining: Promise<void> | null = null;

/** Does what waited, oldest first (one run at a time). */
export function drainOnlineQueue(now = Date.now()): Promise<void> {
  // Cleared once the run has settled: a run with nothing to wait for finishes synchronously,
  // and clearing it from inside would leave the finished run in place for good.
  draining ??= (async () => {
    try {
      for (const j of d().load()) {
        if (jobExpired(j, now)) {
          drop(j.id);
          notices.dismiss(cardKey(j.id));
          continue;
        }
        if (!jobWaiting(j)) continue; // directions waiting for a tap
        if (!(await d().online())) return;
        if (j.kind === 'navigate') {
          // Maps finds the place itself now. Opening it needs Sidekick on screen (Android 10+
          // blocks it from the background) and a recent request; else a tap starts it.
          if (d().active() && navAutoStart(j, now)) {
            await startDirections(j.id);
            continue;
          }
          const ready = { ...j, readyAt: now };
          d().save(
            d()
              .load()
              .map((x) => (x.id === j.id ? ready : x)),
          );
          postReady(ready);
          if (!d().active()) {
            const { title, body } = navReadyLine(j);
            await d()
              .notify(title, body, j.id)
              .catch(() => {});
          }
          continue;
        }
        let text: string;
        try {
          text = await d().answer(j.question, j);
        } catch (e) {
          console.log(`[online] answer failed: ${String(e)}`);
          return; // try again on the next wake-up
        }
        drop(j.id);
        const title = answeredTitle(j, now);
        await d()
          .remember(j.question, text)
          .catch(() => {});
        notices.post({
          key: cardKey(j.id),
          kind: 'decision',
          text: `${title}\n${text}`,
          severity: 1,
          actions: [{ label: 'OK', id: 'ok' }],
        });
        if (!d().active())
          await d()
            .notify(title, text)
            .catch(() => {});
      }
    } finally {
      syncOnlineNative();
    }
  })().finally(() => {
    draining = null;
  });
  return draining;
}

/**
 * The network changed (or work is waiting): records the state, does what waited for the internet,
 * and returns the edges for network routines.
 */
export async function handleNetwork(cur: NetState, now = Date.now()): Promise<NetEdge[]> {
  const edges = networkEdges(d().lastState(), cur);
  d().setLastState(cur);
  if (cur.online) {
    await d().afterOnline();
    await drainOnlineQueue(now);
  }
  syncOnlineNative();
  return edges;
}

/** The cards of what is still waiting, in the chat again after a restart. */
export function restoreOnlineCards(now = Date.now()) {
  for (const j of d().load()) {
    if (jobExpired(j, now)) continue;
    if (jobWaiting(j)) postWaiting(j);
    else postReady(j);
  }
}

const catchUp = () =>
  void (async () => {
    if (d().load().some(jobWaiting) && (await d().online())) await drainOnlineQueue();
  })();

/** At app start: plan native wake-ups (again when routines change) and catch up if online. */
export function startOnlineQueue(): () => void {
  syncOnlineNative();
  restoreOnlineCards();
  catchUp();
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { onRoutinesChange } = require('./routines-store');
  const { getSettings, onSettingsChange } = require('./settings');
  const { onServerReachedAgain } = require('@/web/lookup');
  /* eslint-enable @typescript-eslint/no-require-imports */
  // A page waits for Online to be switched on, not only for the internet.
  let wasOn: boolean = !!getSettings().webLookup;
  const offSettings = onSettingsChange((s: { webLookup: boolean }) => {
    const turnedOn = !wasOn && s.webLookup;
    wasOn = s.webLookup;
    if (turnedOn) catchUp();
  }) as () => void;
  const offRoutines = onRoutinesChange(() => syncOnlineNative()) as () => void;
  // Back on screen: whatever came back while away (the iPhone's only chance, ADR 0006).
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') catchUp();
  });
  // Sidekick's own network back while Android said online all along: no network change comes.
  const offReached = onServerReachedAgain(catchUp);
  const stops = [offSettings, offRoutines, () => appState.remove(), offReached];
  // The iPhone has no native network wake-up: its connection changes while Sidekick is open.
  if (Platform.OS === 'ios') stops.push(watchNetworkIos());
  stops.push(watchDirectionTaps());
  return () => stops.forEach((s) => s());
}

/* eslint-disable @typescript-eslint/no-require-imports */
function watchNetworkIos(): () => void {
  try {
    const { addNetworkStateListener, NetworkStateType } = require('expo-network');
    const sub = addNetworkStateListener(
      (s: { isConnected?: boolean; isInternetReachable?: boolean; type?: string }) => {
        const online = s.isConnected !== false && s.isInternetReachable !== false;
        void handleNetwork({ online, wifi: online && s.type === NetworkStateType.WIFI });
      },
    );
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** A tap on a "Directions … are ready" notification starts them (Sidekick is in front then). */
function watchDirectionTaps(): () => void {
  try {
    const Notifications = require('expo-notifications');
    const onTap = (r: { notification?: { request?: { content?: { data?: unknown } } } }) => {
      const data = r?.notification?.request?.content?.data as
        { tag?: string; job?: string } | undefined;
      if (data?.tag === TAG && data.job) void startDirections(data.job);
    };
    // Opened from the notification with Sidekick closed.
    void Notifications.getLastNotificationResponseAsync?.()
      .then((r: Parameters<typeof onTap>[0] | null) => r && onTap(r))
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(onTap);
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

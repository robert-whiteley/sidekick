/**
 * Work that waits for the internet, done when the phone is back online, also with the app closed:
 * - questions that needed an online lookup or the weather, asked while offline: answered then,
 *   shown in the chat (a card now, and in the chat history) and as a notification;
 * - emails waiting in the outbox, Google Tasks sync and a due Drive backup (their own modules);
 * - network routines ("when I'm back online / on Wi-Fi …", routines.ts).
 * Model downloads need nothing here: Android's download manager waits for Wi-Fi by itself.
 *
 * Android wakes JS through the "SidekickRoutine" task with {type:"network"} (Offline.kt:
 * WorkManager jobs with a network constraint, a 15-minute check, and a live network callback).
 * Logic: online-queue-logic.ts.
 */
import { AppState, Platform } from 'react-native';

import {
  addJob,
  answeredTitle,
  jobExpired,
  type NetEdge,
  type NetState,
  nativeConfig,
  networkEdges,
  type OnlineJob,
  type OnlineJobKind,
  queuedLine,
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
  answer: (question: string) => Promise<string>;
  remember: (question: string, answer: string) => Promise<void>;
  notify: (title: string, body: string) => Promise<void>;
  active: () => boolean;
  afterOnline: () => Promise<void>;
  wantedEdges: () => NetEdge[];
  lastState: () => NetState | null;
  setLastState: (s: NetState) => void;
};

const KV_JOBS = 'online-queue.v1';
const KV_NET = 'online-queue.net';

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
    answer: async (q) => {
      const { answer } = require('./assistant');
      const r = await answer(q, null, () => {}, { routine: true, forceLookup: true });
      return r.text as string;
    },
    remember: (q, a) => require('@/memory/store').rememberExchange(q, a),
    notify: async (title, body) => {
      const Notifications = require('expo-notifications');
      if (!(await Notifications.getPermissionsAsync()).granted) return;
      await Notifications.setNotificationChannelAsync('online', {
        name: 'Answers when back online',
        importance: Notifications.AndroidImportance.DEFAULT,
        // Contents hidden on a secure lock screen (answers can be personal).
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { tag: 'sidekick-online' } },
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
  };
}
/* eslint-enable @typescript-eslint/no-require-imports */

let deps: Deps | null = null;
const d = () => (deps ??= defaultDeps());

/** Tests. */
export function setOnlineQueueDeps(p: Partial<Deps> | null) {
  deps = p ? { ...defaultDeps(), ...p } : null;
}

/** Tells native what is waiting and which network routines exist (plans its wake-ups). */
export function syncOnlineNative() {
  try {
    nat()?.configure(JSON.stringify(nativeConfig(d().load().length, d().wantedEdges())));
  } catch (e) {
    console.log(`[online] configure: ${String(e)}`);
  }
}

/** Keeps [question] for when the phone is back online; returns the line to say now. */
export function queueOnline(kind: OnlineJobKind, question: string, now = Date.now()): string {
  const jobs = d().load();
  const job: OnlineJob = { id: `oq${now}`, kind, question, askedAt: now };
  d().save(addJob(jobs, job));
  syncOnlineNative();
  return queuedLine(kind);
}

export function pendingOnline(): OnlineJob[] {
  return d().load();
}

let draining: Promise<void> | null = null;

/** Answers what waited, oldest first (one run at a time). */
export function drainOnlineQueue(now = Date.now()): Promise<void> {
  draining ??= (async () => {
    try {
      for (const j of d().load()) {
        if (jobExpired(j, now)) {
          d().save(
            d()
              .load()
              .filter((x) => x.id !== j.id),
          );
          continue;
        }
        if (!(await d().online())) return;
        let text: string;
        try {
          text = await d().answer(j.question);
        } catch (e) {
          console.log(`[online] answer failed: ${String(e)}`);
          return; // try again on the next wake-up
        }
        d().save(
          d()
            .load()
            .filter((x) => x.id !== j.id),
        );
        const title = answeredTitle(j, now);
        await d()
          .remember(j.question, text)
          .catch(() => {});
        notices.post({
          key: `online:${j.id}`,
          kind: 'decision',
          text: `${title}\n${text}`,
          actions: [{ label: 'OK', id: 'ok' }],
        });
        if (!d().active())
          await d()
            .notify(title, text)
            .catch(() => {});
      }
    } finally {
      draining = null;
      syncOnlineNative();
    }
  })();
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

/** At app start: plan native wake-ups (again when routines change) and catch up if online. */
export function startOnlineQueue(): () => void {
  syncOnlineNative();
  void (async () => {
    if (d().load().length && (await d().online())) await drainOnlineQueue();
  })();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { onRoutinesChange } = require('./routines-store');
  return onRoutinesChange(() => syncOnlineNative()) as () => void;
}

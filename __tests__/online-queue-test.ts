import { notices } from '@/engine/notices';
import {
  drainOnlineQueue,
  handleNetwork,
  pendingOnline,
  queueOnline,
  setOnlineQueueDeps,
} from '@/engine/online-queue';
import type { NetState, OnlineJob } from '@/engine/online-queue-logic';

const T = new Date(2026, 10, 25, 14, 5).getTime();

function setup(online: boolean) {
  let jobs: OnlineJob[] = [];
  let last: NetState | null = null;
  const env = {
    online,
    answered: [] as string[],
    remembered: [] as string[],
    notified: [] as string[],
    after: 0,
    active: true,
  };
  setOnlineQueueDeps({
    load: () => jobs,
    save: (j) => (jobs = j),
    online: async () => env.online,
    answer: async (q) => {
      env.answered.push(q);
      return `answer to ${q}`;
    },
    remember: async (q) => void env.remembered.push(q),
    notify: async (t) => void env.notified.push(t),
    active: () => env.active,
    afterOnline: async () => void env.after++,
    wantedEdges: () => [],
    lastState: () => last,
    setLastState: (s) => (last = s),
  });
  return env;
}

afterEach(() => setOnlineQueueDeps(null));

it('queues while offline and answers when back online', async () => {
  const env = setup(false);
  expect(queueOnline('lookup', 'who won the match?', T)).toMatch(/back online/);
  await drainOnlineQueue(T);
  expect(env.answered).toEqual([]);
  expect(pendingOnline()).toHaveLength(1);

  env.online = true;
  env.active = false;
  await handleNetwork({ online: false, wifi: false }, T);
  const edges = await handleNetwork({ online: true, wifi: true }, T + 60_000);
  expect(edges).toEqual(['online', 'wifi']);
  expect(env.after).toBe(1);
  expect(env.answered).toEqual(['who won the match?']);
  expect(env.remembered).toEqual(['who won the match?']);
  expect(env.notified).toEqual(['You asked at 14:05: who won the match?']);
  expect(pendingOnline()).toEqual([]);
  expect(notices.all.some((n) => n.text.includes('answer to who won the match?'))).toBe(true);
});

it('drops a stale forecast instead of answering it', async () => {
  const env = setup(true);
  queueOnline('weather', 'will it rain?', T);
  await drainOnlineQueue(T + 7 * 3600_000);
  expect(env.answered).toEqual([]);
  expect(pendingOnline()).toEqual([]);
});

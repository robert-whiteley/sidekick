import { notices } from '@/engine/notices';
import {
  cancelOnline,
  drainOnlineQueue,
  handleNetwork,
  navigateOffline,
  pendingOnline,
  queueOnline,
  restoreOnlineCards,
  setOnlineQueueDeps,
  startDirections,
} from '@/engine/online-queue';
import {
  NAV_AUTO_START_MS,
  type NetState,
  type OnlineJob,
  TOOL_NET,
} from '@/engine/online-queue-logic';
import { TOOLS } from '@/engine/tools-logic';

// A new day for each test: cards are keyed by the time asked, and a card repeats at most daily.
let T = new Date(2026, 10, 25, 14, 5).getTime() - 2 * 86_400_000;
beforeEach(() => {
  T += 2 * 86_400_000;
});

function setup(online: boolean, known: Record<string, { lat: number; lon: number }> = {}) {
  let jobs: OnlineJob[] = [];
  let last: NetState | null = null;
  const env = {
    online,
    answered: [] as string[],
    kinds: [] as string[],
    remembered: [] as string[],
    notified: [] as string[],
    started: [] as string[],
    after: 0,
    active: true,
  };
  setOnlineQueueDeps({
    load: () => jobs,
    save: (j) => (jobs = j),
    online: async () => env.online,
    answer: async (q, job) => {
      env.answered.push(q);
      env.kinds.push(job?.kind ?? '');
      return `answer to ${q}`;
    },
    remember: async (q) => void env.remembered.push(q),
    notify: async (t) => void env.notified.push(t),
    active: () => env.active,
    afterOnline: async () => void env.after++,
    wantedEdges: () => [],
    lastState: () => last,
    setLastState: (s) => (last = s),
    startNav: async (dest, mode) => {
      env.started.push(`${dest} ${mode}`);
      return `Opening directions to ${dest}.`;
    },
    offlinePlace: async (name) => (known[name] ? { name, ...known[name] } : null),
  });
  return env;
}

const card = (id: string) => notices.all.find((n) => n.key === `online:${id}`);

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
  expect(env.notified).toEqual(['You asked at 14:05: who won the match?']); // same day
  expect(pendingOnline()).toEqual([]);
  expect(notices.all.some((n) => n.text.includes('answer to who won the match?'))).toBe(true);
});

it('drops a stale forecast instead of answering it', async () => {
  const env = setup(true);
  queueOnline('weather', 'will it rain?', T);
  await drainOnlineQueue(T + 7 * 3600_000);
  expect(env.answered).toEqual([]);
  expect(pendingOnline()).toEqual([]);
  // That run had nothing to wait for: the next one still runs.
  queueOnline('lookup', 'who won?', T + 7 * 3600_000);
  await drainOnlineQueue(T + 7 * 3600_000);
  expect(env.answered).toEqual(['who won?']);
});

it('every catalog tool says what it needs from the internet', () => {
  expect(TOOLS.map((t) => t.name).filter((n) => !TOOL_NET[n])).toEqual([]);
});

it('queues research offline and runs it as research when back online', async () => {
  const env = setup(false);
  expect(queueOnline('research', 'heat pumps', T, undefined, { news: true })).toMatch(
    /research when you're back online/,
  );
  const [job] = pendingOnline();
  expect(job.news).toBe(true);
  expect(card(job.id)?.actions?.map((a) => a.id)).toEqual(['cancel']);
  env.online = true;
  await drainOnlineQueue(T + 60_000);
  expect(env.kinds).toEqual(['research']);
  expect(pendingOnline()).toEqual([]);
  expect(card(job.id)?.text).toMatch(/answer to heat pumps/);
});

it('starts directions to a place known offline at once, as coordinates', async () => {
  const env = setup(false, { gym: { lat: 53.8, lon: -1.55 } });
  expect(await navigateOffline('gym', 'walking', T)).toMatch(
    /Opening directions to gym.*offline maps/,
  );
  expect(env.started).toEqual(['53.8,-1.55 walking']);
  expect(pendingOnline()).toEqual([]);
});

it('leaves directions to the usual path when online', async () => {
  const env = setup(true);
  expect(await navigateOffline('IKEA Leeds', 'driving', T)).toBeNull();
  expect(env.started).toEqual([]);
});

it('waits with directions it cannot place, offering Maps now and Cancel', async () => {
  const env = setup(false);
  expect(await navigateOffline('IKEA Leeds', 'driving', T)).toMatch(/start directions when/);
  const [job] = pendingOnline();
  expect(job).toMatchObject({ kind: 'navigate', question: 'IKEA Leeds', mode: 'driving' });
  expect(card(job.id)?.actions?.map((a) => a.id)).toEqual(['start', 'cancel']);
  notices.act(`online:${job.id}`, 'start');
  await new Promise((r) => setImmediate(r));
  expect(env.started).toEqual(['IKEA Leeds driving']);
  expect(pendingOnline()).toEqual([]);
});

it('starts recent directions by itself when back online with Sidekick on screen', async () => {
  const env = setup(false);
  await navigateOffline('IKEA Leeds', 'driving', T);
  env.online = true;
  await drainOnlineQueue(T + NAV_AUTO_START_MS - 1000);
  expect(env.started).toEqual(['IKEA Leeds driving']);
  expect(pendingOnline()).toEqual([]);
});

it('in the background or asked long ago, directions wait for a tap', async () => {
  const env = setup(false);
  await navigateOffline('IKEA Leeds', 'driving', T);
  env.online = true;
  env.active = false;
  await drainOnlineQueue(T + 60_000);
  expect(env.started).toEqual([]);
  expect(env.notified).toEqual(['Directions to IKEA Leeds are ready']);
  const [job] = pendingOnline();
  expect(job.readyAt).toBe(T + 60_000);
  expect(card(job.id)?.text).toBe('Directions to IKEA Leeds are ready');
  // On screen again 30 minutes after asking: still not by itself.
  env.active = true;
  await drainOnlineQueue(T + 30 * 60_000);
  expect(env.started).toEqual([]);
  await startDirections(job.id);
  expect(env.started).toEqual(['IKEA Leeds driving']);
  expect(pendingOnline()).toEqual([]);
});

it('drops directions after 3 hours, and Cancel takes one back', async () => {
  const env = setup(false);
  await navigateOffline('IKEA Leeds', 'driving', T);
  env.online = true;
  await drainOnlineQueue(T + 3 * 3600_000 + 1);
  expect(env.started).toEqual([]);
  expect(pendingOnline()).toEqual([]);

  env.online = false;
  await navigateOffline('Leeds station', 'walking', T);
  const [job] = pendingOnline();
  notices.act(`online:${job.id}`, 'cancel');
  expect(pendingOnline()).toEqual([]);
  expect(card(job.id)).toBeUndefined();
});

it('asking for the same directions again keeps only the newer one', async () => {
  setup(false);
  await navigateOffline('IKEA Leeds', 'driving', T);
  await navigateOffline('ikea leeds', 'walking', T + 1000);
  expect(pendingOnline()).toHaveLength(1);
  expect(pendingOnline()[0].mode).toBe('walking');
  cancelOnline(pendingOnline()[0].id);
});

it('shows the cards of what still waits after a restart', () => {
  // Saved by an earlier run of the app (no card in this one yet).
  const job: OnlineJob = { id: 'oq-restart', kind: 'lookup', question: 'who won?', askedAt: T };
  setOnlineQueueDeps({ load: () => [job], save: () => {} });
  restoreOnlineCards(T + 1000);
  expect(card(job.id)?.text).toBe('Waiting for the internet: who won?');
});

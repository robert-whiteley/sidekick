/**
 * Runs routines (set up in routines-store.ts). Android wakes JS through the "SidekickRoutine"
 * task (routines-task.ts) at a routine's time, on a matching message notification, on charging,
 * first unlock and headphones / the car; while the app is open a one-minute check also catches
 * anything missed (the phone was off, battery saver, no exact-alarm access).
 * Each run goes through the normal answer pipeline, so recaps, calendar, to-dos and memory are
 * all available. Drafts made by a routine are never sent by themselves: they wait as a card.
 */
import { AppState } from 'react-native';

import { batteryState } from './battery';
import { isCarDevice } from './hands-free-logic';
import { onPlaceChange } from './location-track';
import {
  type DueRun,
  type Routine,
  type TriggerContext,
  batteryAllows,
  dueRoutines,
  isBriefing,
  isReadOut,
  lateNote,
  messageMatches,
  readOutText,
  routineLabel,
  routineQuestion,
  triggerAllowed,
  upcoming,
} from './routines-logic';
import {
  listRoutines,
  migrateBriefing,
  onRoutinesChange,
  plannedEventAlarms,
  setPlannedEventAlarms,
  syncPlan,
  updateRoutine,
} from './routines-store';

export type RoutinePayload =
  | { type: 'time'; at?: number }
  | {
      type: 'message';
      ids?: string[];
      title?: string | null;
      text?: string | null;
      app?: string | null;
      pkg?: string | null;
    }
  | { type: 'charging' | 'unlock' }
  | { type: 'device'; name?: string; bluetooth?: boolean }
  | { type: 'place'; place: string; edge: 'enter' | 'leave' }
  | { type: 'network'; online: boolean; wifi: boolean; at?: number };

export type RoutineRun = {
  routine: Routine;
  question: string;
  /** Answer without the model (read-out, briefing), or null to ask the model. */
  quick: string | null;
  late: string | null;
};

/** What the chat screen does with a run while it is open (shows and streams it like a question). */
export type RoutineUi = (run: RoutineRun) => Promise<string | null>;

type Deps = {
  ui: () => RoutineUi | null;
  answer: (question: string) => Promise<string>;
  briefing: () => Promise<string | null>;
  notify: (title: string, body: string) => Promise<void>;
  speak: (text: string) => void;
  canSpeakAloud: () => boolean;
  battery: typeof batteryState;
  remember: (question: string, answer: string) => Promise<void>;
  active: () => boolean;
};

let ui: RoutineUi | null = null;

/** The chat screen registers itself while mounted. */
export function setRoutineUi(u: RoutineUi | null) {
  ui = u;
}

function defaultDeps(): Deps {
  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    ui: () => ui,
    answer: async (q) => {
      const { answer } = require('./assistant');
      const r = await answer(q, null, () => {}, { routine: true });
      return r.text as string;
    },
    briefing: () => require('./followup-notify').todaysBriefing(),
    notify: async (title, body) => {
      const Notifications = require('expo-notifications');
      if (!(await Notifications.getPermissionsAsync()).granted) return;
      await Notifications.setNotificationChannelAsync('routines', {
        name: 'Routines',
        importance: Notifications.AndroidImportance.DEFAULT,
        // Contents hidden on a secure lock screen (answers can be personal).
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { tag: 'sidekick-routine' } },
        trigger: { channelId: 'routines' },
      });
    },
    speak: (text) => {
      const { StreamingSpeaker } = require('./speaker');
      new StreamingSpeaker(true).finish(text);
    },
    canSpeakAloud: () => {
      const hf = require('./hands-free');
      const { headphonesOn } = require('./devices');
      // Only into the user's ears or the car, and not in quiet hours / Do Not Disturb.
      return (headphonesOn() || hf.carConnected()) && hf.canSpeakNow();
    },
    battery: batteryState,
    remember: async (q, a) => {
      await require('@/memory/store').rememberExchange(q, a);
    },
    active: () => AppState.currentState === 'active',
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
}

let deps: Deps | null = null;
const d = () => (deps ??= defaultDeps());

/** Tests. */
export function setRoutineDeps(p: Partial<Deps> | null) {
  deps = p ? { ...defaultDeps(), ...p } : null;
}

let running: Promise<void> = Promise.resolve();

/** The task entry: Android said something happened. Runs one at a time. */
export function handleRoutineEvent(p: RoutinePayload, now = Date.now()): Promise<void> {
  running = running
    .then(() => dispatch(p, now))
    .catch((e) => console.log(`[routines] run failed: ${String(e)}`))
    .then(() => syncPlan());
  return running;
}

async function dispatch(p: RoutinePayload, now: number) {
  const list = listRoutines();
  switch (p.type) {
    case 'time':
      return runDue(now);
    case 'message': {
      const ctx: TriggerContext = {
        type: 'message',
        who: p.title ?? null,
        app: p.app ?? null,
        text: p.text ?? null,
      };
      for (const r of list) {
        if (r.when.type !== 'message' || !triggerAllowed(r, now)) continue;
        if (p.ids && !p.ids.includes(r.id)) continue;
        if (
          !messageMatches(r.when, {
            title: p.title ?? null,
            app: p.app ?? null,
            pkg: p.pkg ?? null,
          })
        )
          continue;
        await runOne(r, ctx, null, now);
      }
      return;
    }
    case 'charging':
    case 'unlock':
      for (const r of list)
        if (r.when.type === p.type && triggerAllowed(r, now))
          await runOne(r, { type: p.type }, null, now);
      // A routine that waited for battery runs once charging starts.
      if (p.type === 'charging') await runDue(now);
      return;
    case 'device': {
      const car = !!p.bluetooth && isCarDevice({ kind: 'bluetooth', name: p.name ?? '' });
      const type = car ? 'car' : 'headphones';
      for (const r of list)
        if (r.when.type === type && triggerAllowed(r, now)) await runOne(r, { type }, null, now);
      return;
    }
    case 'place':
      return onPlace(p.edge, p.place, now);
    case 'network': {
      // Back online: what waited for the internet goes first (online-queue.ts), then routines.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { handleNetwork } = require('./online-queue') as typeof import('./online-queue');
      const edges = await handleNetwork({ online: p.online, wifi: p.wifi }, now);
      for (const r of list)
        if (r.when.type === 'network' && edges.includes(r.when.edge) && triggerAllowed(r, now))
          await runOne(r, { type: 'network', edge: r.when.edge }, null, now);
      return;
    }
  }
}

/** Called by location (arrive / leave a named place). */
export async function onPlace(edge: 'enter' | 'leave', placeName: string, now = Date.now()) {
  const name = placeName.trim().toLowerCase();
  for (const r of listRoutines()) {
    if (r.when.type !== 'place' || r.when.edge !== edge || !triggerAllowed(r, now)) continue;
    const want = r.when.place.toLowerCase();
    if (!name.includes(want) && !want.includes(name)) continue;
    await runOne(r, { type: 'place', place: placeName, edge }, null, now);
  }
}

/** Scheduled routines whose time has come (late ones say so), and calendar-event ones. */
async function runDue(now: number) {
  const list = listRoutines();
  const { run, skip } = dueRoutines(list, now);
  // Missed by more than 12 hours: not run now (a morning briefing at night is no use).
  for (const s of skip) updateRoutine(s.routine.id, { lastRunAt: s.dueAt });
  for (const due of run) await runScheduled(due, now);
  const evs = plannedEventAlarms();
  const ready = evs.filter((e) => e.at <= now);
  if (!ready.length) return;
  setPlannedEventAlarms(evs.filter((e) => e.at > now));
  for (const e of ready) {
    const r = list.find((x) => x.id === e.id);
    if (!r || r.paused || e.start < now) continue;
    await runOne(r, { type: 'event', title: e.title, start: e.start }, null, now);
  }
}

async function runScheduled(due: DueRun, now: number) {
  const late = due.late ? lateNote(due.dueAt) : null;
  await runOne(due.routine, { type: 'time' }, late, now, due.dueAt);
}

/** Runs one routine; false when it had to wait (battery). */
async function runOne(
  r: Routine,
  ctx: TriggerContext,
  late: string | null,
  now: number,
  dueAt?: number,
): Promise<boolean> {
  const quick =
    ctx.type === 'message' && isReadOut(r.action)
      ? readOutText(ctx)
      : isBriefing(r.action)
        ? ((await d()
            .briefing()
            .catch(() => null)) ?? 'Nothing on your calendar or to-dos today.')
        : null;
  if (quick == null && !batteryAllows(await d().battery())) {
    // Scheduled ones stay due (they run when charging starts or the app opens, marked late).
    console.log(`[routines] ${r.id} waits: battery low or battery saver`);
    return false;
  }
  updateRoutine(r.id, { lastRunAt: dueAt ?? now });
  const run: RoutineRun = {
    routine: r,
    question: routineQuestion(r.action, ctx, new Date(now)),
    quick,
    late,
  };
  const label = `Routine: ${routineLabel(r)}`;
  const screen = d().ui();
  if (screen && d().active()) {
    await screen(run);
    return true;
  }
  let text: string;
  if (quick != null) {
    text = quick;
    await d()
      .remember(label, quick)
      .catch(() => {});
  } else {
    text = await d().answer(run.question);
  }
  const shown = late ? `${text} ${late}` : text;
  await d()
    .notify(label, shown)
    .catch(() => {});
  if (d().canSpeakAloud()) d().speak(text);
  return true;
}

let started = false;
let tick: ReturnType<typeof setTimeout> | null = null;

/**
 * While the app is open, wakes at the next routine's exact time (at most a minute apart), so a
 * routine due at 23:59 runs at 23:59, not at the next whole-minute check. With the app closed the
 * native alarm does this.
 */
function armTick() {
  if (tick) clearTimeout(tick);
  const now = Date.now();
  const next = upcoming(listRoutines(), now)[0]?.at;
  const wait = next != null ? Math.min(Math.max(next - now + 250, 250), 60_000) : 60_000;
  tick = setTimeout(() => {
    tick = null;
    if (!started) return;
    if (AppState.currentState === 'active') void handleRoutineEvent({ type: 'time' });
    armTick();
  }, wait);
}

/** At app start: migrate the old briefing, plan alarms, catch up, and check each minute while open. */
export function startRoutines(): () => void {
  if (started) return () => {};
  started = true;
  try {
    migrateBriefing();
  } catch (e) {
    console.log(`[routines] migrate: ${String(e)}`);
  }
  void handleRoutineEvent({ type: 'time' });
  armTick();
  // A routine added or changed ("in one minute, …") re-arms the timer for its time.
  const offChange = onRoutinesChange(() => armTick());
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      void handleRoutineEvent({ type: 'time' });
      armTick();
    }
  });
  const offPlace = onPlaceChange((e) => void onPlace(e.type, e.place.name, e.at));
  return () => {
    started = false;
    if (tick) clearTimeout(tick);
    tick = null;
    sub.remove();
    offChange();
    offPlace();
  };
}

/**
 * Routines: storage on the phone (like settings), the plan handed to the native scheduler
 * (alarms, message rules, triggers), and setting one up from a request. Running them is
 * routines.ts. Logic: routines-logic.ts.
 */
import { Platform } from 'react-native';

import {
  type Routine,
  type When,
  briefingRoutine,
  confirmation,
  describeWhen,
  isSchedule,
  newRoutine,
  parseRoutine,
  upcoming,
} from './routines-logic';
import { getSettings, updateSettings } from './settings';
import { parseIntent } from '@/integrations/parse';
import type { KvStore } from '@/integrations/prefs';

const KEY = 'routines.v1'; // gitleaks:allow (storage key name, not a secret)
/** Calendar events looked at for "N minutes before each meeting". */
const EVENT_LOOKAHEAD_MS = 36 * 3_600_000;

type Native = {
  setPlan(json: string): void;
  canExact(): boolean;
  openExactSettings(): void;
};

let store: KvStore | null = null;
let cache: Routine[] | null = null;
let native: Native | null | undefined;
const listeners = new Set<(r: Routine[]) => void>();

function defaultStore(): KvStore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const n = require('../../modules/sidekick-native').default;
  return { get: (k) => n.kvGet(k), set: (k, v) => n.kvSet(k, v) };
}

function routinesNative(): Native | null {
  if (native !== undefined) return native;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo');
    native = Platform.OS === 'android' ? requireOptionalNativeModule('SidekickRoutines') : null;
  } catch {
    native = null;
  }
  return native ?? null;
}

/** Tests: in-memory storage and a fake scheduler. */
export function setRoutinesStore(s: KvStore | null, n: Native | null = null) {
  store = s;
  cache = null;
  native = n;
}

export function listRoutines(): Routine[] {
  if (cache) return cache;
  store ??= defaultStore();
  try {
    const v = JSON.parse(store.get(KEY) ?? '[]');
    cache = Array.isArray(v) ? (v as Routine[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function save(list: Routine[]) {
  cache = list;
  store ??= defaultStore();
  store.set(KEY, JSON.stringify(list));
  listeners.forEach((l) => l(list));
  void syncPlan();
}

export function onRoutinesChange(l: (r: Routine[]) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getRoutine(id: string): Routine | undefined {
  return listRoutines().find((r) => r.id === id);
}

export function addRoutine(
  said: string,
  when: When,
  action: string,
  now = Date.now(),
): { ok: true; routine: Routine } | { ok: false; reason: string } {
  const r = newRoutine(listRoutines(), said, when, action, now);
  if (r.ok) save([...listRoutines(), r.routine]);
  return r;
}

export function updateRoutine(id: string, patch: Partial<Omit<Routine, 'id'>>) {
  save(listRoutines().map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

export function deleteRoutine(id: string) {
  save(listRoutines().filter((r) => r.id !== id));
}

/** Changing the text of a routine: re-parse it; returns why not if it isn't one. */
export function editRoutine(id: string, said: string, now = new Date()): string | null {
  const p = parseRoutine(said, now);
  if (!p) return 'Start with when, e.g. "Every day at 6pm …" or "Whenever Sam messages me, …".';
  if (!p.ok) return p.reason;
  updateRoutine(id, {
    said,
    when: p.when,
    action: p.action,
    lastRunAt: null,
    anchor: now.getTime(),
  });
  return null;
}

// --- The plan for the native scheduler ---

export type EventAlarm = { id: string; at: number; title: string; start: number };
const EVENTS_KEY = 'routines.events.v1'; // gitleaks:allow (storage key name, not a secret)

/** Event alarms planned last time (the task reads them to know which event it was). */
export function plannedEventAlarms(): EventAlarm[] {
  store ??= defaultStore();
  try {
    return JSON.parse(store.get(EVENTS_KEY) ?? '[]') as EventAlarm[];
  } catch {
    return [];
  }
}

export function setPlannedEventAlarms(a: EventAlarm[]) {
  store ??= defaultStore();
  store.set(EVENTS_KEY, JSON.stringify(a));
}

let events: (
  from: number,
  to: number,
) => Promise<{ title: string; start: number; allDay: boolean }[]> = async (from, to) => {
  // Lazy: plain logic tests don't load expo-calendar.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { eventsBetween } = require('@/integrations/calendar');
  return eventsBetween(from, to);
};

/** Tests. */
export function setEventsSource(f: typeof events) {
  events = f;
}

let planChain: Promise<void> = Promise.resolve();

/** Hands the next alarms and the trigger rules to Android. */
export function syncPlan(now = Date.now()): Promise<void> {
  planChain = planChain
    .then(() => plan(now))
    .catch((e) => console.log(`[routines] plan: ${String(e)}`));
  return planChain;
}

async function plan(now: number) {
  const n = routinesNative();
  const list = listRoutines().filter((r) => !r.paused);
  const alarms: { id: string; at: number }[] = upcoming(list, now);
  const eventRoutines = list.filter((r) => r.when.type === 'event');
  const eventAlarms: EventAlarm[] = [];
  if (eventRoutines.length) {
    const evs = await events(now, now + EVENT_LOOKAHEAD_MS).catch(() => []);
    for (const r of eventRoutines) {
      const before = r.when.type === 'event' ? r.when.minutesBefore : 10;
      for (const e of evs) {
        if (e.allDay) continue;
        const at = e.start - before * 60_000;
        if (at > now) eventAlarms.push({ id: r.id, at, title: e.title, start: e.start });
      }
    }
  }
  setPlannedEventAlarms(eventAlarms);
  // Event alarms re-plan the day ahead too: one alarm a day at the latest.
  const refresh = list.some((r) => r.when.type === 'event')
    ? [{ id: '_plan', at: now + 12 * 3_600_000 }]
    : [];
  const messages = list.flatMap((r) =>
    r.when.type === 'message' ? [{ id: r.id, who: r.when.who ?? '', app: r.when.app ?? '' }] : [],
  );
  const triggers = [...new Set(list.filter((r) => !isSchedule(r.when)).map((r) => r.when.type))];
  n?.setPlan(
    JSON.stringify({
      alarms: [...alarms, ...eventAlarms.map((e) => ({ id: e.id, at: e.at })), ...refresh],
      messages,
      triggers,
    }),
  );
}

/** Exact times need "Alarms & reminders" on Android 12+ (else up to ~10 min late in Doze). */
export function exactRoutinesAllowed(): boolean {
  return routinesNative()?.canExact() ?? true;
}

export function openExactRoutineSettings() {
  routinesNative()?.openExactSettings();
}

// --- Migration: the old fixed daily briefing becomes a routine ---

export function migrateBriefing(now = Date.now()) {
  const s = getSettings();
  if (!s.followupDigest) return;
  const b = briefingRoutine(s.digestHour ?? 8);
  const exists = listRoutines().some((r) => r.action === b.action && r.when.type === 'daily');
  if (!exists) addRoutine(b.said, b.when, b.action, now);
  updateSettings({ followupDigest: false });
}

// --- Setting one up from the chat ---

/**
 * "Every day at 6pm give me a recap of my day", "whenever Sam messages me, read it out":
 * saves the routine and returns the reply; null when [question] isn't a routine. One-off sends
 * ("at 6pm text Sam …") stay scheduled sends, not routines.
 */
export function routineRequest(
  question: string,
  now = new Date(),
): { text: string; routineId?: string } | null {
  const p = parseRoutine(question, now);
  if (!p) return null;
  if (!p.ok) return { text: p.reason };
  if (p.when.type === 'once' && parseIntent(p.action, now)) return null;
  const r = addRoutine(question.trim(), p.when, p.action, now.getTime());
  if (!r.ok) return { text: r.reason };
  return { text: confirmation(r.routine, now), routineId: r.routine.id };
}

/** The chat card after setting one up: Undo or change it in Settings. */
export function postRoutineCard(id: string) {
  const r = getRoutine(id);
  if (!r) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { notices } = require('./notices');
  notices.post(
    {
      key: `routine-${id}`,
      kind: 'decision',
      text: `Routine: ${describeWhen(r.when)} · ${r.action}`,
      actions: [
        { label: 'Undo', id: 'undo' },
        { label: 'Change', id: 'edit' },
      ],
    },
    (action: string) => {
      if (action === 'undo') deleteRoutine(id);
      else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('expo-router').router.push('/settings/routines');
      }
    },
  );
}

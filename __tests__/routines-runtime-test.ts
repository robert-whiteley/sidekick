import { handleRoutineEvent, onPlace, setRoutineDeps, setRoutineUi } from '@/engine/routines';
import {
  addRoutine,
  listRoutines,
  migrateBriefing,
  routineRequest,
  setEventsSource,
  setRoutinesStore,
  syncPlan,
} from '@/engine/routines-store';

const mockSettings: Record<string, unknown> = { followupDigest: true, digestHour: 7 };
jest.mock('@/engine/settings', () => ({
  getSettings: () => mockSettings,
  updateSettings: (p: Record<string, unknown>) => Object.assign(mockSettings, p),
}));
jest.mock('expo-battery', () => ({}));
jest.mock('@/engine/location-track', () => ({ onPlaceChange: () => () => {} }));

function memStore() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) };
}

let plans: string[];
let answered: string[];
let notified: [string, string][];
let spoken: string[];
let battery = { charging: false, batteryLevel: 0.8, lowPowerMode: false };

beforeEach(() => {
  plans = [];
  answered = [];
  notified = [];
  spoken = [];
  battery = { charging: false, batteryLevel: 0.8, lowPowerMode: false };
  setRoutinesStore(memStore(), {
    setPlan: (j) => void plans.push(j),
    canExact: () => true,
    openExactSettings: () => {},
  });
  setEventsSource(async () => []);
  setRoutineUi(null);
  setRoutineDeps({
    ui: () => null,
    answer: async (q) => {
      answered.push(q);
      return `answer to ${q}`;
    },
    briefing: async () => 'On your calendar: Dentist at 10:00.',
    notify: async (t, b) => void notified.push([t, b]),
    speak: (t) => void spoken.push(t),
    canSpeakAloud: () => false,
    battery: async () => battery,
    remember: async () => {},
    active: () => false,
  });
  mockSettings.followupDigest = true;
});

const T = (h: number, m = 0, day = 25) => new Date(2026, 10, day, h, m).getTime();

it('sets one up from the chat and plans its alarm', async () => {
  const r = routineRequest('every day at 6pm give me a recap of my day', new Date(T(12)));
  expect(r?.text).toMatch(/^OK\. Every day at 18:00, I'll: give me a recap of my day/);
  await syncPlan(T(12));
  const plan = JSON.parse(plans.at(-1)!);
  expect(plan.alarms).toEqual([{ id: listRoutines()[0].id, at: T(18) }]);
});

it('runs at its time through the answer pipeline, once', async () => {
  addRoutine('s', { type: 'daily', hour: 18, minute: 0 }, 'give me a recap of my day', T(12));
  await handleRoutineEvent({ type: 'time' }, T(18, 0));
  await handleRoutineEvent({ type: 'time' }, T(18, 1));
  expect(answered).toEqual(['give me a recap of my day']);
  expect(notified[0][0]).toBe('Routine: Give me a recap of my day');
});

it('marks a late run and waits on low battery', async () => {
  addRoutine('s', { type: 'daily', hour: 18, minute: 0 }, 'recap', T(12));
  battery = { charging: false, batteryLevel: 0.1, lowPowerMode: false };
  await handleRoutineEvent({ type: 'time' }, T(18));
  expect(answered).toEqual([]);
  battery = { charging: true, batteryLevel: 0.1, lowPowerMode: false };
  await handleRoutineEvent({ type: 'charging' }, T(19));
  expect(answered).toEqual(['recap']);
  expect(notified[0][1]).toMatch(/Late: this was due at 18:00/);
});

it('the briefing needs no model', async () => {
  migrateBriefing(T(6));
  expect(mockSettings.followupDigest).toBe(false);
  expect(listRoutines()[0]).toMatchObject({ action: 'brief me', when: { hour: 7 } });
  battery = { charging: false, batteryLevel: 0.05, lowPowerMode: true };
  await handleRoutineEvent({ type: 'time' }, T(7, 1));
  expect(answered).toEqual([]);
  expect(notified[0][1]).toBe('On your calendar: Dentist at 10:00.');
});

it('message trigger: read it out, matching sender only', async () => {
  routineRequest('whenever Sam messages me, read it out', new Date(T(12)));
  await handleRoutineEvent(
    { type: 'message', title: 'Jo', text: 'hi', app: 'WhatsApp', pkg: 'com.whatsapp' },
    T(13),
  );
  expect(notified).toEqual([]);
  await handleRoutineEvent(
    {
      type: 'message',
      title: 'Sam Taylor',
      text: 'running late',
      app: 'WhatsApp',
      pkg: 'com.whatsapp',
    },
    T(13),
  );
  expect(notified[0][1]).toBe('Sam Taylor on WhatsApp says: running late');
  expect(answered).toEqual([]);
  const plan = JSON.parse(plans.at(-1)!);
  expect(plan.messages).toEqual([{ id: listRoutines()[0].id, who: 'Sam', app: '' }]);
  expect(plan.triggers).toEqual(['message']);
});

it('message trigger with a model action gets the message as context', async () => {
  routineRequest('whenever anyone messages me, tell me if it is urgent', new Date(T(12)));
  await handleRoutineEvent(
    { type: 'message', title: 'Jo', text: 'call me now', app: 'Messages' },
    T(13),
  );
  expect(answered[0]).toBe(
    'A message from Jo on Messages just arrived: "call me now". tell me if it is urgent',
  );
});

it('car vs headphones, place and the chat screen', async () => {
  routineRequest('when I get in the car tell me my to-dos', new Date(T(12)));
  routineRequest('when I connect my headphones, tell me my next meeting', new Date(T(12)));
  await handleRoutineEvent({ type: 'device', name: 'Ford SYNC', bluetooth: true }, T(13));
  expect(answered).toEqual(['tell me my to-dos']);
  await handleRoutineEvent({ type: 'device', name: 'Pixel Buds', bluetooth: true }, T(13));
  expect(answered).toEqual(['tell me my to-dos', 'tell me my next meeting']);

  routineRequest('when I get home remind me what I said I would do', new Date(T(12)));
  const shown: string[] = [];
  setRoutineDeps({
    ui: () => async (run) => {
      shown.push(run.question);
      return null;
    },
    active: () => true,
    battery: async () => battery,
  });
  await onPlace('enter', 'Home', T(14));
  expect(shown).toEqual(['I just arrived at Home. remind me what I said I would do']);
});

it('calendar event alarms', async () => {
  const start = T(15);
  setEventsSource(async () => [{ title: 'Standup', start, allDay: false }]);
  routineRequest('10 minutes before each meeting tell me what it is', new Date(T(12)));
  await syncPlan(T(12));
  const plan = JSON.parse(plans.at(-1)!);
  expect(plan.alarms.some((a: { at: number }) => a.at === T(14, 50))).toBe(true);
  await handleRoutineEvent({ type: 'time' }, T(14, 50));
  expect(answered).toEqual(['"Standup" starts in 10 minutes. tell me what it is']);
});

import { drafts, flushOutbox, planIntent, runAction } from '../src/engine/actions';
import { setIntegrationsNative } from '../src/integrations/native';
import { setPrefsStore, setSwitch } from '../src/integrations/prefs';

const mockQueued = new Map<
  string,
  { id: string; draft: string; tries: number; createdAt: number; lastError: null }
>();
jest.mock('../src/engine/llm', () => ({ askLlm: jest.fn() }));
jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('../src/engine/settings', () => ({ getSettings: () => ({ actionSend: 'ask' }) }));
jest.mock('../src/integrations/google-tasks', () => ({ syncGoogleTasks: async () => 0 }));
jest.mock('../src/memory/followups', () => ({ onFollowupsChange: () => () => {} }));
jest.mock('../src/memory/outbox', () => ({
  enqueue: jest.fn(
    async (id: string, draft: string) =>
      void mockQueued.set(id, { id, draft, tries: 0, createdAt: 0, lastError: null }),
  ),
  pending: jest.fn(async () => [...mockQueued.values()]),
  remove: jest.fn(async (id: string) => void mockQueued.delete(id)),
  noteFailure: jest.fn(async () => {}),
}));
jest.mock('../src/integrations/contacts', () => ({
  contactNameList: async () => ['Sam Taylor'],
  findContact: async (n: string) =>
    /sam/i.test(n)
      ? { name: 'Sam Taylor', phones: ['+441234'], emails: ['sam@example.com'] }
      : null,
}));
jest.mock('expo-constants', () => ({
  expoConfig: { extra: { google: { androidClientId: 'id.apps.googleusercontent.com' } } },
}));

const now = new Date(2025, 10, 24, 14, 0);
const native = {
  isInstalled: () => true,
  setAlarm: jest.fn(() => true),
  setTimer: jest.fn(() => true),
  call: jest.fn(() => true),
  navigate: jest.fn(() => true),
  openMessage: jest.fn(() => true),
  notificationAccess: jest.fn(() => true),
  openNotificationAccess: jest.fn(),
  messageThreads: jest.fn(() =>
    JSON.stringify([
      {
        key: 'k1',
        pkg: 'com.whatsapp',
        app: 'WhatsApp',
        conversation: 'Jo',
        sender: 'Jo',
        text: 'Dinner?',
        at: 5,
        canReply: true,
      },
    ]),
  ),
  replyToMessage: jest.fn(() => true),
  nowPlaying: jest.fn(() =>
    JSON.stringify({ app: 'Spotify', title: 'Song', artist: 'Band', playing: true }),
  ),
  mediaCommand: jest.fn(() => true),
  googleAuthorize: jest.fn(async () => 'tok'),
  googleClearToken: jest.fn(async () => {}),
};

beforeEach(() => {
  jest.clearAllMocks();
  drafts.clear();
  mockQueued.clear();
  const m = new Map<string, string>();
  setPrefsStore({ get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) });
  setIntegrationsNative(native);
});

it('drafts a message and sends nothing until Send', async () => {
  const p = await planIntent(
    { type: 'message', name: 'Sam Taylor', text: "I'm running late", app: 'auto' },
    now,
  );
  expect(p?.kind).toBe('draft');
  if (p?.kind !== 'draft' || p.draft.kind !== 'message') throw new Error();
  expect(p.draft.fields).toMatchObject({
    name: 'Sam Taylor',
    to: '+441234',
    text: "I'm running late",
  });
  expect(p.draft.title).toBe('Message to Sam Taylor');
  expect(native.openMessage).not.toHaveBeenCalled();
  const done = await runAction(p.draft.id);
  expect(native.openMessage).toHaveBeenCalledWith('sms', '+441234', "I'm running late");
  expect(done.status).toBe('sent');
  expect(done.note).toMatch(/tap Send there/);
});

it('"send it" runs the newest open draft; cancel cancels', async () => {
  await planIntent({ type: 'call', name: 'Sam' }, now);
  expect(native.call).not.toHaveBeenCalled();
  const r = await planIntent({ type: 'sendIt' }, now);
  expect(r).toEqual({ kind: 'reply', text: expect.any(String) });
  expect(native.call).toHaveBeenCalledWith('+441234', expect.any(Boolean));
  await planIntent({ type: 'message', name: 'Sam', text: 'hello', app: 'auto' }, now);
  expect(await planIntent({ type: 'cancelIt' }, now)).toEqual({
    kind: 'reply',
    text: 'Cancelled.',
  });
  expect(drafts.all().at(-1)?.status).toBe('cancelled');
  expect(native.openMessage).not.toHaveBeenCalled();
  expect(await planIntent({ type: 'sendIt' }, now)).toBeNull();
});

it('replies through the notification', async () => {
  const p = await planIntent({ type: 'reply', name: null, text: 'Sounds good' }, now);
  if (p?.kind !== 'draft') throw new Error();
  expect(native.replyToMessage).not.toHaveBeenCalled();
  await runAction(p.draft.id);
  expect(native.replyToMessage).toHaveBeenCalledWith('k1', 'Sounds good');
});

it('sets alarms and timers at once, respects switches', async () => {
  expect(await planIntent({ type: 'alarm', hour: 6, minute: 30, label: '' }, now)).toEqual({
    kind: 'reply',
    text: 'Alarm set for 06:30.',
  });
  expect(native.setAlarm).toHaveBeenCalledWith(6, 30, '');
  setSwitch('alarms', 'set', false);
  expect((await planIntent({ type: 'timer', seconds: 300, label: '' }, now))?.kind).toBe('reply');
  expect(native.setTimer).not.toHaveBeenCalled();
});

it('asks for notification access when missing', async () => {
  native.notificationAccess.mockReturnValueOnce(false);
  const r = await planIntent({ type: 'readMessages', name: null }, now);
  expect(r).toMatchObject({ kind: 'reply', text: expect.stringMatching(/Notification access/) });
});

it("what's playing", async () => {
  expect(await planIntent({ type: 'nowPlaying' }, now)).toEqual({
    kind: 'reply',
    text: 'Playing: Song by Band (Spotify).',
  });
});

it('queues an email offline and sends it when back online', async () => {
  const p = await planIntent(
    { type: 'email', name: 'Sam', subject: 'Friday', body: 'See you there' },
    now,
  );
  if (p?.kind !== 'draft') throw new Error();
  const fetchMock = jest.fn().mockRejectedValueOnce(new Error('offline'));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const q = await runAction(p.draft.id);
  expect(q.status).toBe('queued');
  expect(mockQueued.size).toBe(1);
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
  expect(await flushOutbox()).toBe(1);
  expect(mockQueued.size).toBe(0);
  expect(drafts.get(p.draft.id)?.status).toBe('sent');
  expect(fetchMock.mock.calls[1][0]).toMatch(/gmail\.googleapis\.com/);
});

import { drafts, flushOutbox, planAction, runAction } from '../src/engine/actions';
import { setIntegrationsNative } from '../src/integrations/native';
import { setPrefsStore, setSwitch } from '../src/integrations/prefs';

const mockQueued = new Map<
  string,
  { id: string; draft: string; tries: number; createdAt: number; lastError: null }
>();
jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
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
jest.mock('../src/integrations/llm-parse', () => ({ intentFromLlm: async () => null }));
jest.mock('expo-constants', () => ({
  expoConfig: { extra: { google: { androidClientId: 'id.apps.googleusercontent.com' } } },
}));

const now = new Date(2025, 10, 24, 14, 0);
const native = {
  flavour: () => 'play' as const,
  isInstalled: () => true,
  setAlarm: jest.fn(() => true),
  setTimer: jest.fn(() => true),
  call: jest.fn(() => true),
  navigate: jest.fn(() => true),
  openMessage: jest.fn(() => true),
  sendSms: jest.fn(() => true),
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
  accessibilityEnabled: () => false,
  openAccessibilitySettings: jest.fn(),
  armAutoSend: jest.fn(() => true),
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
  const p = await planAction("text Sam Taylor I'm running late", { now });
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
  await planAction('call Sam', { now });
  const r = await planAction('send it', { now });
  expect(r).toEqual({ kind: 'reply', text: expect.any(String) });
  expect(native.call).toHaveBeenCalledWith('+441234', expect.any(Boolean));
  await planAction('text Sam hello', { now });
  expect(await planAction('cancel', { now })).toEqual({ kind: 'reply', text: 'Cancelled.' });
  expect(drafts.all().at(-1)?.status).toBe('cancelled');
  expect(await planAction('send it', { now })).toBeNull();
});

it('replies through the notification', async () => {
  const p = await planAction('reply sounds good', { now });
  if (p?.kind !== 'draft') throw new Error();
  await runAction(p.draft.id);
  expect(native.replyToMessage).toHaveBeenCalledWith('k1', 'Sounds good');
});

it('sets alarms and timers at once, respects switches', async () => {
  expect(await planAction('set an alarm for 6:30', { now })).toEqual({
    kind: 'reply',
    text: 'Alarm set for 06:30.',
  });
  expect(native.setAlarm).toHaveBeenCalledWith(6, 30, '');
  setSwitch('alarms', 'set', false);
  expect((await planAction('set a timer for 5 minutes', { now }))?.kind).toBe('reply');
  expect(native.setTimer).not.toHaveBeenCalled();
});

it('asks for notification access when missing', async () => {
  native.notificationAccess.mockReturnValueOnce(false);
  const r = await planAction('read my messages', { now });
  expect(r).toMatchObject({ kind: 'reply', text: expect.stringMatching(/Notification access/) });
});

it("what's playing and plain questions", async () => {
  expect(await planAction("what's playing", { now })).toEqual({
    kind: 'reply',
    text: 'Playing: Song by Band (Spotify).',
  });
  expect(await planAction('what is the capital of France', { now })).toBeNull();
});

it('queues an email offline and sends it when back online', async () => {
  const p = await planAction('email Sam about Friday saying see you there', { now });
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

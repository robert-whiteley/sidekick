import { AUTO_SEND_MS, autoSend, drafts, holdDraft } from '@/engine/actions';
import type { Draft } from '@/integrations/types';

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('@/integrations/google-tasks', () => ({ syncGoogleTasks: async () => 0 }));
jest.mock('@/memory/followups', () => ({ onFollowupsChange: () => () => {} }));
jest.mock('@/integrations/native', () => ({
  integrationsNative: () => null,
  messageThreads: () => [],
  nowPlaying: () => null,
}));
jest.mock('@/integrations/messages', () => ({
  ...jest.requireActual('@/integrations/messages'),
  sendMessage: jest.fn(async () => ({ note: 'Sent' })),
}));
jest.mock('@/memory/outbox', () => ({ enqueue: jest.fn(), remove: jest.fn(async () => {}) }));
jest.mock('@/engine/settings', () => ({ getSettings: () => ({ actionSend: 'countdown' }) }));

const msg = (id: string, to: string | null = '+440000'): Draft =>
  ({
    id,
    kind: 'message',
    title: 'Message to Sam',
    fields: { name: 'Sam', to, text: 'Late', app: 'sms' },
    integration: 'messages',
    status: 'draft',
    at: 0,
  }) as Draft;

beforeEach(() => {
  jest.useFakeTimers();
  drafts.clear();
});
afterEach(() => jest.useRealTimers());

test('countdown sends after 5 s unless cancelled', async () => {
  drafts.put(msg('a'));
  drafts.put(msg('b'));
  autoSend('a');
  autoSend('b');
  drafts.cancel('b');
  await jest.advanceTimersByTimeAsync(AUTO_SEND_MS + 10);
  expect(drafts.get('a')?.status).toBe('sent');
  expect(drafts.get('b')?.status).toBe('cancelled');
});

test('editing stops the countdown; no recipient never auto-sends; ask waits', async () => {
  drafts.put(msg('c'));
  drafts.put(msg('d', null));
  drafts.put(msg('e'));
  autoSend('c');
  holdDraft('c');
  autoSend('d');
  autoSend('e', 'ask');
  await jest.advanceTimersByTimeAsync(AUTO_SEND_MS + 10);
  expect(drafts.get('c')?.status).toBe('draft');
  expect(drafts.get('d')?.status).toBe('draft');
  expect(drafts.get('e')?.status).toBe('draft');
});

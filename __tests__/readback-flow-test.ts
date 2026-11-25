import {
  AUTO_SEND_MS,
  awaitingReadBack,
  beginReadBack,
  drafts,
  flushOutbox,
  planAction,
  readBackDone,
  runAction,
} from '@/engine/actions';
import { READ_BACK_REPLY_MS } from '@/engine/readback-logic';
import { sendMessage } from '@/integrations/messages';
import type { Draft } from '@/integrations/types';
import * as outbox from '@/memory/outbox';

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('@/integrations/google-tasks', () => ({ syncGoogleTasks: async () => 0 }));
jest.mock('@/memory/followups', () => ({ onFollowupsChange: () => () => {} }));
jest.mock('@/integrations/contacts', () => ({
  contactNameList: async () => [],
  findContact: async () => null,
}));
jest.mock('@/integrations/llm-parse', () => ({ intentFromLlm: async () => null }));
jest.mock('@/integrations/native', () => ({
  integrationsNative: () => null,
  messageThreads: () => [],
  nowPlaying: () => null,
}));
jest.mock('@/integrations/messages', () => ({
  ...jest.requireActual('@/integrations/messages'),
  sendMessage: jest.fn(async () => ({ note: 'Sent' })),
}));
const rows: { id: string; draft: string; tries: number }[] = [];
jest.mock('@/memory/outbox', () => ({
  enqueue: jest.fn(async (id: string, draft: string) => {
    rows.push({ id, draft, tries: 0 });
  }),
  pending: jest.fn(async () => [...rows]),
  remove: jest.fn(async (id: string) => {
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows.splice(i, 1);
  }),
  noteFailure: jest.fn(async () => {}),
}));
jest.mock('@/engine/settings', () => ({ getSettings: () => ({ actionSend: 'countdown' }) }));

const msg = (id: string, extra: Partial<Draft> = {}): Draft =>
  ({
    id,
    kind: 'message',
    title: 'Message to Sam',
    fields: { name: 'Sam', to: '+440000', text: 'Running late', app: 'sms' },
    integration: 'messages',
    status: 'draft',
    at: 0,
    ...extra,
  }) as Draft;

beforeEach(() => {
  jest.useFakeTimers();
  drafts.clear();
  rows.length = 0;
  (sendMessage as jest.Mock).mockClear();
});
afterEach(() => jest.useRealTimers());

test('read-back: countdown starts only after the voice, then sends', async () => {
  drafts.put(msg('a'));
  expect(beginReadBack('a')).toBe('Text to Sam: Running late. Send it?');
  expect(awaitingReadBack()).toBe('a');
  await jest.advanceTimersByTimeAsync(3000); // still speaking: nothing sent
  expect(drafts.get('a')?.status).toBe('draft');
  readBackDone('a');
  await jest.advanceTimersByTimeAsync(READ_BACK_REPLY_MS + AUTO_SEND_MS - 100);
  expect(drafts.get('a')?.status).toBe('draft');
  await jest.advanceTimersByTimeAsync(200);
  expect(drafts.get('a')?.status).toBe('sent');
});

test('voice answers: yes sends, no cancels, "change it to" edits and reads back again', async () => {
  drafts.put(msg('y'));
  beginReadBack('y');
  expect(await planAction('yes send it', { useModel: false })).toEqual({
    kind: 'reply',
    text: 'Sent',
  });
  expect(drafts.get('y')?.status).toBe('sent');

  drafts.put(msg('n'));
  beginReadBack('n');
  expect(await planAction('no', { useModel: false })).toEqual({
    kind: 'reply',
    text: 'Cancelled.',
  });
  expect(drafts.get('n')?.status).toBe('cancelled');

  drafts.put(msg('c'));
  beginReadBack('c');
  const r = await planAction('change it to on my way', { useModel: false });
  expect(r).toEqual({ kind: 'reply', text: 'Text to Sam: On my way. Send it?', readBackId: 'c' });
  expect(drafts.get('c')).toMatchObject({ status: 'draft', fields: { text: 'On my way' } });
  const a = await planAction('add see you soon', { useModel: false });
  expect(a?.kind === 'reply' && a.text).toBe('Text to Sam: On my way. See you soon. Send it?');
});

test('no read-back pending: "yes" is not taken as an answer', async () => {
  drafts.put(msg('z'));
  expect(awaitingReadBack()).toBeNull();
  // Plain "yes" with no draft read back falls through (no action).
  expect(await planAction('yes', { useModel: false })).toBeNull();
});

test('scheduled send: queued until its time, then sent; cancel removes it', async () => {
  const now = Date.now();
  drafts.put(msg('s', { scheduledAt: now + 60 * 60_000 }));
  const d = await runAction('s');
  expect(d.status).toBe('queued');
  expect(d.note).toMatch(/^Sends /);
  expect(outbox.enqueue).toHaveBeenCalled();
  expect(await flushOutbox({ scheduledOnly: true, now: now + 30 * 60_000 })).toBe(0);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(await flushOutbox({ scheduledOnly: true, now: now + 61 * 60_000 })).toBe(1);
  expect(drafts.get('s')?.status).toBe('sent');
  expect(rows).toHaveLength(0);

  drafts.put(msg('x', { scheduledAt: now + 60 * 60_000 }));
  await runAction('x');
  drafts.cancel('x');
  await flushOutbox({ scheduledOnly: true, now: now + 61 * 60_000 });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(drafts.get('x')?.status).toBe('cancelled');
});

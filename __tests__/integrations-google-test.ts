import { sessionRequest } from '../src/integrations/drive-backup';
import { googleConfigured } from '../src/integrations/google';
import {
  fromDue,
  localHash,
  planSync,
  toDue,
  type LocalTask,
  type RemoteTask,
} from '../src/integrations/tasks-sync-logic';

const day = (d: number, h = 9) => new Date(2025, 10, d, h).getTime();
const L = (id: number, title: string, dueAt: number | null = null, done = false): LocalTask => ({
  id,
  title,
  dueAt,
  done,
  allDay: false,
});
const R = (id: string, title: string, extra: Partial<RemoteTask> = {}): RemoteTask => ({
  id,
  title,
  status: 'needsAction',
  updated: 'u1',
  ...extra,
});

describe('google config', () => {
  it('needs a client id', () => {
    expect(googleConfigured({ google: { androidClientId: '' } })).toBe(false);
    expect(googleConfigured({ google: { androidClientId: 'abc' } })).toBe(true);
  });
});

describe('task dates', () => {
  it('round-trips the date and keeps a same-day time', () => {
    expect(toDue(day(25, 15))).toBe('2025-11-25T00:00:00.000Z');
    expect(fromDue('2025-11-25T00:00:00.000Z', day(25, 15))).toEqual({
      dueAt: day(25, 15),
      allDay: false,
    });
    expect(fromDue('2025-11-26T00:00:00.000Z', day(25, 15))).toEqual({
      dueAt: day(26),
      allDay: true,
    });
    expect(fromDue(null)).toEqual({ dueAt: null, allDay: false });
  });
});

describe('planSync', () => {
  it('creates both ways, skipping old completed Google tasks', () => {
    const ops = planSync(
      [L(1, 'Milk')],
      [R('a', 'Bins'), R('b', 'Old', { status: 'completed' })],
      [],
    );
    expect(ops).toEqual([
      { op: 'createRemote', local: L(1, 'Milk') },
      { op: 'createLocal', remote: R('a', 'Bins') },
    ]);
  });
  it('copies changes; Sidekick wins a conflict', () => {
    const l = L(1, 'Milk');
    const link = { localId: 1, remoteId: 'a', localHash: localHash(l), remoteUpdated: 'u1' };
    expect(planSync([l], [R('a', 'Milk')], [link])).toEqual([]);
    expect(planSync([l], [R('a', 'Oat milk', { updated: 'u2' })], [link])).toEqual([
      { op: 'updateLocal', localId: 1, remote: R('a', 'Oat milk', { updated: 'u2' }) },
    ]);
    const edited = L(1, 'Milk x2');
    expect(planSync([edited], [R('a', 'Oat milk', { updated: 'u2' })], [link])).toEqual([
      { op: 'updateRemote', local: edited, remoteId: 'a' },
    ]);
  });
  it('deletes follow: Google deletion dismisses here, local deletion deletes there', () => {
    const link = {
      localId: 1,
      remoteId: 'a',
      localHash: localHash(L(1, 'Milk')),
      remoteUpdated: 'u1',
    };
    expect(planSync([L(1, 'Milk')], [], [link])).toEqual([
      { op: 'dismissLocal', localId: 1, remoteId: 'a' },
    ]);
    expect(planSync([], [R('a', 'Milk')], [link])).toEqual([
      { op: 'deleteRemote', remoteId: 'a', localId: 1 },
    ]);
    expect(planSync([L(1, 'Milk')], [R('a', 'Milk', { deleted: true })], [link])[0].op).toBe(
      'dismissLocal',
    );
  });
});

describe('drive backup', () => {
  it('replaces the earlier file when known', () => {
    expect(sessionRequest('b.zip', null)).toMatchObject({
      method: 'POST',
      url: expect.stringContaining('uploadType=resumable'),
    });
    expect(sessionRequest('b.zip', 'F1')).toMatchObject({
      method: 'PATCH',
      url: expect.stringContaining('/files/F1?'),
    });
  });
});

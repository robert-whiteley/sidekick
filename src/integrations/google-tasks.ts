/** Runs the Google Tasks sync plan (tasks-sync-logic.ts) when its switch is on. */
import { getDb } from '@/memory/db';
import { addFollowupReturningId, listFollowups, updateFollowup } from './followups-bridge';
import { googleConfigured, googleFetch } from './google';
import { isOn } from './prefs';
import {
  type Link,
  type LocalTask,
  localHash,
  planSync,
  type RemoteTask,
  fromDue,
  toDue,
} from './tasks-sync-logic';

const API = 'https://tasks.googleapis.com/tasks/v1';
const LIST = `${API}/lists/@default/tasks`;

let ready = false;
async function db() {
  const d = await getDb();
  if (!ready) {
    await d.execute(`CREATE TABLE IF NOT EXISTS google_task_links (
       local_id INTEGER PRIMARY KEY,
       remote_id TEXT NOT NULL,
       local_hash TEXT NOT NULL,
       remote_updated TEXT NOT NULL
     )`);
    ready = true;
  }
  return d;
}

async function links(): Promise<Link[]> {
  const r = await (await db()).execute('SELECT * FROM google_task_links');
  return r.rows.map((x) => ({
    localId: x.local_id as number,
    remoteId: x.remote_id as string,
    localHash: x.local_hash as string,
    remoteUpdated: x.remote_updated as string,
  }));
}

async function saveLink(l: Link) {
  await (
    await db()
  ).execute(
    'INSERT OR REPLACE INTO google_task_links (local_id, remote_id, local_hash, remote_updated) VALUES (?, ?, ?, ?)',
    [l.localId, l.remoteId, l.localHash, l.remoteUpdated],
  );
}

async function dropLink(localId: number) {
  await (await db()).execute('DELETE FROM google_task_links WHERE local_id = ?', [localId]);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Google Tasks error ${res.status}`);
  return (await res.json()) as T;
}

async function remoteTasks(f: typeof fetch): Promise<RemoteTask[]> {
  const out: RemoteTask[] = [];
  let page: string | undefined;
  do {
    const url = `${LIST}?showCompleted=true&showHidden=true&maxResults=100${page ? `&pageToken=${page}` : ''}`;
    const r = await json<{ items?: RemoteTask[]; nextPageToken?: string }>(
      await googleFetch('tasks', url, {}, f),
    );
    out.push(...(r.items ?? []));
    page = r.nextPageToken;
  } while (page);
  return out;
}

const body = (l: LocalTask) =>
  JSON.stringify({
    title: l.title,
    due: toDue(l.dueAt),
    status: l.done ? 'completed' : 'needsAction',
  });

/** One sync pass; returns the number of changes made. No-op unless switched on and set up. */
export async function syncGoogleTasks(f: typeof fetch = fetch): Promise<number> {
  if (!googleConfigured() || !isOn('googleTasks', 'sync')) return 0;
  const local: LocalTask[] = (await listFollowups())
    .filter(
      (x) =>
        (x.kind === 'todo' || x.kind === 'reminder') &&
        (x.status === 'approved' || x.status === 'done'),
    )
    .map((x) => ({
      id: x.id,
      title: x.title,
      dueAt: x.dueAt,
      done: x.status === 'done',
      allDay: x.allDay,
    }));
  const ops = planSync(local, await remoteTasks(f), await links());
  const H = { 'Content-Type': 'application/json' };
  for (const o of ops) {
    switch (o.op) {
      case 'createRemote': {
        const r = await json<RemoteTask>(
          await googleFetch('tasks', LIST, { method: 'POST', headers: H, body: body(o.local) }, f),
        );
        await saveLink({
          localId: o.local.id,
          remoteId: r.id,
          localHash: localHash(o.local),
          remoteUpdated: r.updated,
        });
        break;
      }
      case 'updateRemote': {
        const r = await json<RemoteTask>(
          await googleFetch(
            'tasks',
            `${LIST}/${o.remoteId}`,
            { method: 'PATCH', headers: H, body: body(o.local) },
            f,
          ),
        );
        await saveLink({
          localId: o.local.id,
          remoteId: r.id,
          localHash: localHash(o.local),
          remoteUpdated: r.updated,
        });
        break;
      }
      case 'deleteRemote': {
        const res = await googleFetch('tasks', `${LIST}/${o.remoteId}`, { method: 'DELETE' }, f);
        if (!res.ok && res.status !== 404) throw new Error(`Google Tasks error ${res.status}`);
        await dropLink(o.localId);
        break;
      }
      case 'createLocal': {
        const due = fromDue(o.remote.due);
        const id = await addFollowupReturningId({
          kind: due.dueAt ? 'reminder' : 'todo',
          title: o.remote.title,
          dueAt: due.dueAt,
          allDay: due.allDay,
          whenText: '',
        });
        const l: LocalTask = {
          id,
          title: o.remote.title,
          dueAt: due.dueAt,
          done: false,
          allDay: due.allDay,
        };
        await saveLink({
          localId: id,
          remoteId: o.remote.id,
          localHash: localHash(l),
          remoteUpdated: o.remote.updated,
        });
        break;
      }
      case 'updateLocal': {
        const before = local.find((l) => l.id === o.localId)!;
        const due = fromDue(o.remote.due, before.dueAt);
        const done = o.remote.status === 'completed';
        await updateFollowup(o.localId, {
          title: o.remote.title,
          dueAt: due.dueAt,
          allDay: due.dueAt === before.dueAt ? before.allDay : due.allDay,
          status: done ? 'done' : 'approved',
        });
        const l: LocalTask = { ...before, title: o.remote.title, dueAt: due.dueAt, done };
        await saveLink({
          localId: o.localId,
          remoteId: o.remote.id,
          localHash: localHash(l),
          remoteUpdated: o.remote.updated,
        });
        break;
      }
      case 'dismissLocal':
        await updateFollowup(o.localId, { status: 'dismissed' });
        await dropLink(o.localId);
        break;
    }
  }
  return ops.length;
}

/** Turning the switch off forgets the pairing (nothing is deleted on either side). */
export async function forgetGoogleTasks() {
  await (await db()).execute('DELETE FROM google_task_links');
}

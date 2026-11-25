/**
 * Two-way sync of Sidekick to-dos/reminders (approved or done) with the user's default Google
 * Tasks list. Pure planning; google-tasks.ts runs the plan. Rules:
 * - New on one side → created on the other. Changed on one side since the last sync → copied.
 * - Changed on both → Sidekick's version wins (it is what the user just did here).
 * - Deleted in Google Tasks → dismissed in Sidekick (hidden, not erased); deleted in Sidekick →
 *   deleted in Google Tasks.
 * Google Tasks keeps only a date (no time), so a Sidekick time stays as it is unless the date
 * changed in Google.
 */

export type LocalTask = {
  id: number;
  title: string;
  dueAt: number | null;
  done: boolean;
  allDay: boolean;
};
export type RemoteTask = {
  id: string;
  title: string;
  /** RFC 3339, date part only is meaningful. */
  due?: string | null;
  status: 'needsAction' | 'completed';
  updated: string;
  deleted?: boolean;
};
export type Link = { localId: number; remoteId: string; localHash: string; remoteUpdated: string };

export type SyncOp =
  | { op: 'createRemote'; local: LocalTask }
  | { op: 'updateRemote'; local: LocalTask; remoteId: string }
  | { op: 'deleteRemote'; remoteId: string; localId: number }
  | { op: 'createLocal'; remote: RemoteTask }
  | { op: 'updateLocal'; localId: number; remote: RemoteTask }
  | { op: 'dismissLocal'; localId: number; remoteId: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** Local date → Google's due ("2025-11-25T00:00:00.000Z"). */
export function toDue(ms: number | null): string | null {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000Z`;
}

/** Google's due → local ms at 09:00 that day (all-day), keeping [keepTime]'s time if same day. */
export function fromDue(
  due: string | null | undefined,
  keep: number | null = null,
): { dueAt: number | null; allDay: boolean } {
  if (!due) return { dueAt: null, allDay: false };
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due);
  if (!m) return { dueAt: null, allDay: false };
  if (keep != null && toDue(keep)?.slice(0, 10) === due.slice(0, 10))
    return { dueAt: keep, allDay: false };
  return { dueAt: new Date(+m[1], +m[2] - 1, +m[3], 9).getTime(), allDay: true };
}

export function localHash(t: LocalTask): string {
  return JSON.stringify([t.title, toDue(t.dueAt), t.done]);
}

function sameContent(l: LocalTask, r: RemoteTask): boolean {
  return (
    l.title === r.title &&
    toDue(l.dueAt)?.slice(0, 10) === (r.due ?? null)?.slice(0, 10) &&
    l.done === (r.status === 'completed')
  );
}

export function planSync(local: LocalTask[], remote: RemoteTask[], links: Link[]): SyncOp[] {
  const ops: SyncOp[] = [];
  const localById = new Map(local.map((l) => [l.id, l]));
  const remoteById = new Map(remote.filter((r) => !r.deleted).map((r) => [r.id, r]));
  const linkedLocal = new Set(links.map((l) => l.localId));
  const linkedRemote = new Set(links.map((l) => l.remoteId));

  for (const link of links) {
    const l = localById.get(link.localId);
    const r = remoteById.get(link.remoteId);
    if (!l && !r) continue;
    if (!l) {
      ops.push({ op: 'deleteRemote', remoteId: link.remoteId, localId: link.localId });
      continue;
    }
    if (!r) {
      ops.push({ op: 'dismissLocal', localId: l.id, remoteId: link.remoteId });
      continue;
    }
    const localChanged = localHash(l) !== link.localHash;
    const remoteChanged = r.updated !== link.remoteUpdated;
    if (localChanged) ops.push({ op: 'updateRemote', local: l, remoteId: r.id });
    else if (remoteChanged && !sameContent(l, r))
      ops.push({ op: 'updateLocal', localId: l.id, remote: r });
  }
  for (const l of local) if (!linkedLocal.has(l.id)) ops.push({ op: 'createRemote', local: l });
  for (const r of remoteById.values()) {
    if (linkedRemote.has(r.id)) continue;
    // A completed Google task never seen before is history, not a new to-do.
    if (r.status === 'completed') continue;
    ops.push({ op: 'createLocal', remote: r });
  }
  return ops;
}

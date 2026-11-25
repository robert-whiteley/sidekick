import { getDb } from './db';
import {
  type Followup,
  followupLineText,
  type FollowupKind,
  type FollowupStatus,
  newProposals,
  type ProposedFollowup,
} from './followup-logic';

/** Only recent lines are read: "tomorrow" said a week ago is no use as a proposal. */
export const SCAN_WINDOW_MS = 2 * 86_400_000;

type Row = Record<string, unknown>;
const toFollowup = (r: Row): Followup => ({
  id: r.id as number,
  kind: r.kind as FollowupKind,
  title: r.title as string,
  dueAt: (r.due_at as number | null) ?? null,
  allDay: !!r.all_day,
  whenText: (r.when_text as string) ?? '',
  status: r.status as FollowupStatus,
  createdAt: r.created_at as number,
  sourceMomentId: (r.source_moment_id as number | null) ?? null,
  personId: (r.person_id as number | null) ?? null,
  personName: (r.person_name as string | null) ?? null,
});

const listeners = new Set<() => void>();
/** Called after any change, e.g. to reschedule notifications. */
export function onFollowupsChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
const changed = () => listeners.forEach((l) => l());
/** For changes made outside this file (e.g. requests saved from a person's words). */
export const notifyFollowupsChanged = changed;

/**
 * Lines said or noted on a photo that haven't been read for follow-ups (oldest first). Questions to
 * Sidekick are not: they are requests to it, not to-dos ("remind me …" is handled directly).
 */
export async function linesForFollowups(
  limit: number,
  now = Date.now(),
): Promise<{ id: number; at: number; text: string; who: string }[]> {
  const db = await getDb();
  const r = await db.execute(
    `SELECT m.id, m.at, m.text, m.kind, s.name, s.is_owner FROM moments m
     LEFT JOIN speakers s ON s.id = m.speaker_id
     WHERE m.followups_scanned = 0 AND m.kind IN ('speech', 'photo')
       AND length(m.text) > 0 AND m.at > ? ORDER BY m.at LIMIT ?`,
    [now - SCAN_WINDOW_MS, limit],
  );
  const read = r.rows.map((x) => ({
    x,
    text: followupLineText(x.kind as string, x.text as string),
  }));
  // Nothing to read (a photo question with no answer): mark it now, or it blocks the queue.
  await markFollowupsScanned(read.filter((l) => l.text == null).map((l) => l.x.id as number));
  return read
    .flatMap(({ x, text }) => (text == null ? [] : [{ x, text }]))
    .map(({ x, text }) => ({
      id: x.id as number,
      at: x.at as number,
      text: text.slice(0, 400),
      who:
        x.kind === 'photo'
          ? 'Photo I took'
          : x.is_owner
            ? 'Me'
            : ((x.name as string | null) ?? 'Someone'),
    }));
}

export async function markFollowupsScanned(ids: number[]) {
  if (!ids.length) return;
  const db = await getDb();
  await db.execute(
    `UPDATE moments SET followups_scanned = 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
}

export async function listFollowups(): Promise<Followup[]> {
  const db = await getDb();
  const r = await db.execute(
    `SELECT f.*, COALESCE(s.name, s.description, 'Person ' || s.label_no) AS person_name FROM followups f
     LEFT JOIN speakers s ON s.id = f.person_id
     WHERE f.status != 'dismissed' ORDER BY f.status = 'done', f.due_at IS NULL, f.due_at, f.created_at DESC`,
  );
  return r.rows.map(toFollowup);
}

/** Saves model proposals for approval, skipping ones already known (including dismissed). */
export async function suggestFollowups(proposed: ProposedFollowup[], now = Date.now()) {
  // A time already past (beyond an hour) is stale: don't propose it.
  const timely = proposed.filter((p) => p.dueAt == null || p.dueAt > now - 3_600_000);
  if (!timely.length) return 0;
  const db = await getDb();
  const existing = (await db.execute('SELECT title, due_at FROM followups')).rows.map((r) => ({
    title: r.title as string,
    dueAt: (r.due_at as number | null) ?? null,
  }));
  const fresh = newProposals(timely, existing);
  for (const p of fresh) {
    await db.execute(
      "INSERT INTO followups (kind, title, due_at, all_day, when_text, status, created_at, source_moment_id) VALUES (?, ?, ?, ?, ?, 'suggested', ?, ?)",
      [p.kind, p.title, p.dueAt, p.allDay ? 1 : 0, p.whenText, now, p.sourceMomentId],
    );
  }
  if (fresh.length) changed();
  return fresh.length;
}

/** Adds one the user typed (already approved). */
export async function addFollowup(
  f: Pick<Followup, 'kind' | 'title' | 'dueAt' | 'allDay' | 'whenText'>,
) {
  const db = await getDb();
  await db.execute(
    "INSERT INTO followups (kind, title, due_at, all_day, when_text, status, created_at) VALUES (?, ?, ?, ?, ?, 'approved', ?)",
    [f.kind, f.title, f.dueAt, f.allDay ? 1 : 0, f.whenText, Date.now()],
  );
  changed();
}

export async function updateFollowup(
  id: number,
  patch: Partial<Pick<Followup, 'kind' | 'title' | 'dueAt' | 'allDay' | 'whenText' | 'status'>>,
) {
  const cols: Record<string, unknown> = {
    kind: patch.kind,
    title: patch.title,
    due_at: patch.dueAt,
    all_day: patch.allDay == null ? undefined : patch.allDay ? 1 : 0,
    when_text: patch.whenText,
    status: patch.status,
  };
  const set = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (!set.length) return;
  const db = await getDb();
  await db.execute(`UPDATE followups SET ${set.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, [
    ...set.map(([, v]) => v as string | number | null),
    id,
  ]);
  changed();
}

/** Dismissed rows are kept (title only matters) so the same proposal isn't made again. */
export const dismissFollowup = (id: number) => updateFollowup(id, { status: 'dismissed' });

export async function deleteFollowup(id: number) {
  const db = await getDb();
  await db.execute('DELETE FROM followups WHERE id = ?', [id]);
  changed();
}

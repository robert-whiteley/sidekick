/** The follow-ups store, plus an insert that returns the new row id (for sync links). */
import { getDb } from '@/memory/db';
import type { Followup } from '@/memory/followup-logic';
import { notifyFollowupsChanged } from '@/memory/followups';

export { listFollowups, updateFollowup } from '@/memory/followups';

export async function addFollowupReturningId(
  f: Pick<Followup, 'kind' | 'title' | 'dueAt' | 'allDay' | 'whenText'>,
): Promise<number> {
  const db = await getDb();
  const r = await db.execute(
    "INSERT INTO followups (kind, title, due_at, all_day, when_text, status, created_at) VALUES (?, ?, ?, ?, ?, 'approved', ?)",
    [f.kind, f.title, f.dueAt, f.allDay ? 1 : 0, f.whenText, Date.now()],
  );
  notifyFollowupsChanged();
  return Number(r.insertId);
}

import { notices } from './notices';
import { getSettings, updateSettings } from './settings';
import { notesBetween } from '@/memory/conversation-notes';
import { getDb } from '@/memory/db';
import {
  dayStart,
  type DayRecap,
  distinctPlaces,
  isEmptyRecap,
  recapDue,
  recapLine,
} from '@/memory/day-recap-logic';
import { listFollowups } from '@/memory/followups';

const DAY = 86_400_000;

/** Everything for one day's recap (the chat line and the recap page). */
export async function buildDayRecap(day: number): Promise<DayRecap> {
  const from = dayStart(day);
  const to = from + DAY;
  const db = await getDb();
  const notes = (await notesBetween(from, to)).map((n) => ({
    id: n.id,
    at: n.from,
    title: n.text.split('\n')[0],
    text: n.text.split('\n').slice(1).join('\n'),
  }));
  const places = distinctPlaces(
    (
      await db.execute(
        'SELECT place FROM moments WHERE at >= ? AND at < ? AND place IS NOT NULL ORDER BY at',
        [from, to],
      )
    ).rows.map((r) => r.place as string),
  );
  // What the camera saw and was read (photos and described frames), latest first.
  const seenRows = (
    await db.execute(
      `SELECT id, at, text FROM moments WHERE at >= ? AND at < ? AND kind IN ('photo', 'frame')
       AND length(text) > 0 ORDER BY at DESC LIMIT 20`,
      [from, to],
    )
  ).rows;
  const seen: DayRecap['seen'] = [];
  for (const r of seenRows) {
    const text = (r.text as string).replace(/^Q:[\s\S]*?\nA:\s*/, '').slice(0, 200);
    if (text && !seen.some((s) => s.text === text))
      seen.push({ id: r.id as number, at: r.at as number, text });
    if (seen.length >= 5) break;
  }
  const items = await listFollowups();
  const today = (d: number | null) => d != null && d >= from && d < to;
  const done = items.filter((f) => f.status === 'done' && today(f.dueAt)).map((f) => f.title);
  const pending = items
    .filter((f) => f.status === 'approved' && f.dueAt != null && f.dueAt < to)
    .map((f) => f.title);
  return { day: from, notes, places, seen, done: done.slice(0, 10), pending: pending.slice(0, 10) };
}

/** Posts the evening "Your day" line once a day at the chosen time (off by default). */
export async function postDayRecapIfDue(now = Date.now()) {
  const s = getSettings();
  if (!recapDue(s.dayRecap, s.lastDayRecapAt, now)) return;
  updateSettings({ lastDayRecapAt: now });
  try {
    const r = await buildDayRecap(now);
    if (isEmptyRecap(r)) return;
    notices.post({
      key: 'day-recap',
      kind: 'info',
      text: recapLine(r),
      href: `/recap?day=${r.day}`,
    });
  } catch (e) {
    console.log(`[recap] failed: ${String(e)}`);
  }
}

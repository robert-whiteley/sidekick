/** "Your day" evening recap (docs/PLAN-v2.md): when it is due and what it says. Pure; tested. */

export const RECAP_TIMES = ['18:00', '19:00', '20:00', '21:00', '22:00'] as const;

/** 'HH:MM' → minutes after midnight, or null if not a time ('off', null). */
export function recapMinutes(setting: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(setting ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Due once a day, from the chosen time until midnight. */
export function recapDue(setting: string | null, lastAt: number | null, now: number): boolean {
  const min = recapMinutes(setting);
  if (min == null) return false;
  const d = new Date(dayStart(now));
  d.setHours(Math.floor(min / 60), min % 60);
  const at = d.getTime();
  return now >= at && (lastAt ?? 0) < at;
}

export type DayRecap = {
  day: number;
  notes: { id: number; at: number; title: string; text: string }[];
  places: string[];
  seen: { id: number; at: number; text: string }[];
  done: string[];
  pending: string[];
};

export const isEmptyRecap = (r: DayRecap) =>
  !r.notes.length && !r.places.length && !r.seen.length && !r.done.length && !r.pending.length;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one faint line in the chat ("Your day: 2 conversations, 3 places, 1 to-do done"). */
export function recapLine(r: DayRecap): string {
  const parts: string[] = [];
  if (r.notes.length) parts.push(plural(r.notes.length, 'conversation'));
  if (r.places.length) parts.push(plural(r.places.length, 'place'));
  if (r.seen.length) parts.push(plural(r.seen.length, 'thing seen', 'things seen'));
  if (r.done.length) parts.push(`${plural(r.done.length, 'to-do')} done`);
  if (r.pending.length) parts.push(`${r.pending.length} still to do`);
  return `Your day: ${parts.join(', ') || 'a quiet one'}`;
}

/** Distinct places in the order first visited. */
export function distinctPlaces(places: (string | null)[]): string[] {
  const out: string[] = [];
  for (const p of places) if (p && !out.includes(p)) out.push(p);
  return out.slice(0, 8);
}

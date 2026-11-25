/**
 * Adds and changes calendar events (after the user taps Add on the card). Reading for answers
 * stays in memory/sources.ts (the calendar data source).
 */
import type { EventFields } from './types';

async function api() {
  return import('expo-calendar');
}

export async function calendarAllowed(ask = true): Promise<boolean> {
  const Calendar = await api();
  if ((await Calendar.getCalendarPermissions()).status === 'granted') return true;
  return ask && (await Calendar.requestCalendarPermissions()).status === 'granted';
}

type CalLike = {
  id: string;
  isPrimary?: boolean;
  allowsModifications?: boolean;
  isVisible?: boolean;
};

/** Android has no single default calendar: the primary writable one, else the first writable. */
export function pickCalendar<T extends CalLike>(cals: T[]): T | null {
  const writable = cals.filter((c) => c.allowsModifications !== false && c.isVisible !== false);
  return writable.find((c) => c.isPrimary) ?? writable[0] ?? null;
}

function details(f: EventFields) {
  const start = new Date(f.start);
  // All-day events end at the start of the next day.
  const end = f.allDay
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
    : new Date(f.end);
  const startDay = f.allDay
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate())
    : start;
  return {
    title: f.title,
    startDate: startDay,
    endDate: end,
    allDay: f.allDay,
    location: f.location || null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Creates or updates the event; returns its id. */
export async function saveEvent(f: EventFields): Promise<string> {
  if (!(await calendarAllowed())) throw new Error('Calendar permission not given');
  const Calendar = await api();
  if (f.eventId) {
    const ev = await Calendar.ExpoCalendarEvent.get(f.eventId);
    await ev.update(details(f));
    return f.eventId;
  }
  const cal = pickCalendar(await Calendar.getCalendars(Calendar.EntityTypes.EVENT));
  if (!cal) throw new Error('No calendar on this phone accepts new events');
  const ev = await cal.createEvent(details(f));
  return ev.id;
}

/** The upcoming event best matching [title] (for "move the dentist to 4"). */
export async function findEvent(
  title: string,
  now = Date.now(),
): Promise<{
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
} | null> {
  if (!(await calendarAllowed(false))) return null;
  const Calendar = await api();
  const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  if (!cals.length) return null;
  const events = await Calendar.listEvents(
    cals,
    new Date(now - 86_400_000),
    new Date(now + 60 * 86_400_000),
  );
  const want = title.toLowerCase();
  const hit = events
    .filter((e) => (e.title ?? '').toLowerCase().includes(want))
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())[0];
  if (!hit) return null;
  return {
    id: hit.id,
    title: hit.title,
    start: new Date(hit.startDate).getTime(),
    end: new Date(hit.endDate).getTime(),
    allDay: !!hit.allDay,
    location: hit.location ?? '',
  };
}

/** Events between [from] and [to] (the daily briefing). Empty without calendar access; never asks. */
export async function eventsBetween(
  from: number,
  to: number,
): Promise<{ title: string; start: number; allDay: boolean }[]> {
  if (!(await calendarAllowed(false))) return [];
  const Calendar = await api();
  const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  if (!cals.length) return [];
  const events = await Calendar.listEvents(cals, new Date(from), new Date(to));
  return events.map((e) => ({
    title: e.title ?? 'Event',
    start: new Date(e.startDate).getTime(),
    allDay: !!e.allDay,
  }));
}

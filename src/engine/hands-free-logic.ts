/**
 * Hands-free (driving / walking) mode, quiet hours, reading incoming messages aloud, the daily
 * briefing. Pure; tested in __tests__/hands-free-logic-test.ts.
 * Runtime wiring: engine/hands-free.ts.
 */
import type { MessageThread } from '@/integrations/native';

export type HandsFreeMode = 'auto' | 'on' | 'off';
export type ReadIncomingMode = 'off' | 'headphones' | 'always';

/**
 * Car kits name themselves after the car or the head unit. Android's Bluetooth class needs an
 * extra permission, so the name is the signal (ADR 0006). Headphones like "Jabra" or "AirPods"
 * don't match.
 */
export const CAR_NAME =
  /\b(car|auto|vehicle|uconnect|sync|mylink|intellilink|mmi|idrive|carplay|android auto|handsfree|hands-free|carkit|car kit|parrot|pioneer|kenwood|alpine|jvc|sony xav|harman|becker|audi|bmw|mini|mercedes|benz|vw|volkswagen|skoda|seat|cupra|ford|toyota|lexus|honda|nissan|mazda|subaru|kia|hyundai|peugeot|citroen|renault|dacia|opel|vauxhall|fiat|volvo|tesla|polestar|jaguar|land rover|range rover|porsche|chevrolet|chevy|gmc|dodge|jeep|ram|chrysler|cadillac|buick|mitsubishi|suzuki|mg)\b/i;
export const NOT_CAR =
  /\b(buds|pods|airpods|headphones?|headset|earbuds?|speaker|soundbar|watch|tv)\b/i;

export function isCarDevice(o: { kind: string; name: string }): boolean {
  return o.kind === 'bluetooth' && CAR_NAME.test(o.name) && !NOT_CAR.test(o.name);
}

/** Hands-free is on: forced on, or (auto) a car is connected or headset-button walk mode is on. */
export function handsFreeActive(
  mode: HandsFreeMode | null | undefined,
  o: { car: boolean; walkMode: boolean },
): boolean {
  switch (mode ?? 'auto') {
    case 'on':
      return true;
    case 'off':
      return false;
    default:
      return o.car || o.walkMode;
  }
}

/** Minutes since midnight in [start, end), wrapping past midnight (22:00–07:00). */
export function inQuietWindow(now: Date, start: number, end: number): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/**
 * May Sidekick speak out loud now? Not during quiet hours or Do Not Disturb, unless it is going
 * into headphones (or the car, where the driver asked for it).
 */
export function speechAllowed(o: {
  quiet: boolean;
  now: Date;
  start: number;
  end: number;
  dnd: boolean;
  private: boolean;
}): boolean {
  if (o.private) return true;
  if (o.dnd) return false;
  return !(o.quiet && inQuietWindow(o.now, o.start, o.end));
}

export function readIncomingWanted(
  mode: ReadIncomingMode | null | undefined,
  o: { headphones: boolean; handsFree: boolean },
): boolean {
  switch (mode ?? 'off') {
    case 'always':
      return true;
    case 'headphones':
      return o.headphones || o.handsFree;
    default:
      return false;
  }
}

/** Threads newer than [since] that can be read out, oldest first, one per conversation. */
export function newIncoming(threads: MessageThread[], since: number): MessageThread[] {
  const latest = new Map<string, MessageThread>();
  for (const t of threads) {
    if (t.at <= since) continue;
    const k = `${t.pkg}:${t.conversation || t.sender}`;
    const cur = latest.get(k);
    if (!cur || t.at > cur.at) latest.set(k, t);
  }
  return [...latest.values()].sort((a, b) => a.at - b.at);
}

const MAX_SPOKEN_CHARS = 280;

/** "Sam on WhatsApp says: running late. Say reply and your answer." */
export function incomingSpeech(t: MessageThread): string {
  const who =
    t.conversation && t.conversation !== t.sender
      ? `${t.sender} in ${t.conversation}`
      : t.sender || t.conversation;
  let text = t.text.replace(/\s+/g, ' ').trim();
  if (text.length > MAX_SPOKEN_CHARS) text = `${text.slice(0, MAX_SPOKEN_CHARS)}…`;
  return `${who} on ${t.app} says: ${text}${t.canReply ? ' Say reply and your answer.' : ''}`;
}

const startOfDay = (d: Date, add = 0) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + add).getTime();

// --- Daily briefing ---

/** Is the briefing due now: after the chosen time today and not yet given today. */
export function briefingDue(now: Date, minutes: number, lastGiven: number | null): boolean {
  const at = startOfDay(now) + minutes * 60_000;
  return now.getTime() >= at && (lastGiven == null || lastGiven < at);
}

export type BriefingEvent = { title: string; start: number; allDay: boolean };

/** "Good morning. On your calendar: …. " plus the follow-up digest. Null if nothing at all. */
export function briefingText(
  events: BriefingEvent[],
  digest: string | null,
  now: Date,
): string | null {
  const today = events
    .filter((e) => e.start >= startOfDay(now) && e.start < startOfDay(now, 1))
    .sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  if (today.length) {
    const fmt = (e: BriefingEvent) =>
      e.allDay
        ? e.title
        : `${e.title} at ${new Date(e.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    parts.push(`On your calendar: ${today.map(fmt).join('; ')}.`);
  }
  if (digest) parts.push(digest);
  return parts.length ? parts.join(' ') : null;
}

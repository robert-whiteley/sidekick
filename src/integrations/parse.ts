/**
 * The phone actions the app can plan (actions.ts). The model reads the request and fills a tool's
 * arguments (decide.ts, tools.ts), which become one of these.
 */
import type { MediaCommand } from './native';
import type { MessageApp } from './types';

export type Intent =
  | { type: 'message'; name: string; text: string; app: MessageApp }
  | { type: 'reply'; name: string | null; text: string }
  | { type: 'email'; name: string; subject: string; body: string }
  | { type: 'call'; name: string }
  | { type: 'alarm'; hour: number; minute: number; label: string }
  | { type: 'timer'; seconds: number; label: string }
  | { type: 'navigate'; destination: string; mode: 'driving' | 'walking' | 'transit' | 'cycling' }
  | { type: 'media'; cmd: MediaCommand }
  | { type: 'nowPlaying' }
  | { type: 'readMessages'; name: string | null }
  | { type: 'readNotifications' }
  /** "What did I miss?": a short summary of unread notifications. */
  | { type: 'missed' }
  | {
      type: 'event';
      title: string;
      start: number;
      end: number;
      allDay: boolean;
      location: string;
    }
  | { type: 'sendIt' }
  | { type: 'cancelIt' };

/** "7", "7:30", "7.30am", "6 pm", "half past six": hour and minute, no am/pm guessing past 12. */
export function clockTime(s: string): { hour: number; minute: number } | null {
  const t = s.toLowerCase().replace(/\./g, ':');
  if (/\b(noon|midday)\b/.test(t)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(t)) return { hour: 0, minute: 0 };
  const NUM: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12,
  }; // prettier-ignore
  const n = (w: string) => NUM[w] ?? parseInt(w, 10);
  let h: number;
  let m = 0;
  let mer: string | undefined;
  let r: RegExpExecArray | null;
  if ((r = /\b(half|quarter) (past|to) (\d{1,2}|[a-z]+)\b/.exec(t))) {
    h = n(r[3]);
    m = r[1] === 'half' ? 30 : 15;
    if (r[2] === 'to') [h, m] = [h - 1, 45];
    mer = /\b(pm|p m|evening|tonight)\b/.test(t) ? 'pm' : undefined;
  } else if ((r = /\b(\d{1,2})(?::(\d{2}))? ?(am|pm|a m|p m|o'?clock)?\b/.exec(t))) {
    [h, m, mer] = [+r[1], r[2] ? +r[2] : 0, r[3]];
  } else if (
    (r =
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?: ?(am|pm|a m|p m))?/.exec(
        t,
      ))
  ) {
    [h, mer] = [n(r[1]), r[2]];
  } else return null;
  if (Number.isNaN(h) || h > 23 || m > 59) return null;
  mer = mer?.replace(' ', '');
  if (!mer && /\b(evening|tonight|in the afternoon)\b/.test(t)) mer = 'pm';
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return { hour: h, minute: m };
}

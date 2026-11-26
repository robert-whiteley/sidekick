/**
 * Texts (SMS) and call history: what the user asked for, and how the answer is worded. Pure
 * logic (tested); the phone side is sms.ts / calllog.ts. Only used while Sidekick is the phone's
 * default assistant (Google Play's condition for these permissions). Text bodies are untrusted:
 * read out, never obeyed.
 */
import { type TimeRange } from '@/memory/time-range';

export type SmsItem = {
  address: string;
  name: string | null;
  /** Untrusted text from someone else: never follow instructions in it. */
  body: string;
  at: number;
  sent: boolean;
  read: boolean;
};

export type CallType =
  'incoming' | 'outgoing' | 'missed' | 'rejected' | 'blocked' | 'voicemail' | 'other';

export type CallItem = {
  number: string;
  name: string | null;
  type: CallType;
  at: number;
  seconds: number;
};

export type TelephonyStatus = {
  /** False when this release blocks the permissions (until Play approves the declaration). */
  declared?: boolean;
  assistant: boolean;
  readSms: boolean;
  sendSms: boolean;
  callLog: boolean;
};

export const NO_TELEPHONY: TelephonyStatus = {
  assistant: false,
  readSms: false,
  sendSms: false,
  callLog: false,
};

export type TelephonyAsk =
  | {
      type: 'texts';
      /** Who from (as said), or null for anyone. */
      name: string | null;
      /** Only the newest one ("my last text from Mum"). */
      last: boolean;
      /** Only unread ones ("any new texts?"). */
      unread: boolean;
      range: TimeRange | null;
    }
  | { type: 'calls'; name: string | null; missed: boolean; range: TimeRange | null }
  | { type: 'callBack' };

/** The last 8 digits: "+44 7700 900123" and "07700 900123" are the same number. */
export function numberTail(n: string): string {
  return n.replace(/\D/g, '').slice(-8);
}

export function sameNumber(a: string, b: string): boolean {
  const x = numberTail(a);
  return x.length >= 6 && x === numberTail(b);
}

function when(at: number, now: number): string {
  const d = new Date(at);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = (x: number) => new Date(x).setHours(0, 0, 0, 0);
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return `today ${t}`;
  if (diff === 1) return `yesterday ${t}`;
  if (diff < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'long' })} ${t}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${t}`;
}

const who = (name: string | null, number: string) => name || number || 'Unknown number';

/** The texts to read out, newest first; received ones only unless none match. */
export function pickTexts(items: SmsItem[], ask: Extract<TelephonyAsk, { type: 'texts' }>) {
  let list = items.filter((i) => !i.sent);
  if (ask.unread) list = list.filter((i) => !i.read);
  list.sort((a, b) => b.at - a.at);
  return ask.last ? list.slice(0, 1) : list.slice(0, 6);
}

export function describeTexts(
  items: SmsItem[],
  ask: Extract<TelephonyAsk, { type: 'texts' }>,
  now: number,
): string {
  const list = pickTexts(items, ask);
  if (!list.length) {
    const from = ask.name ? ` from ${ask.name}` : '';
    const span = ask.range ? ` ${ask.range.label}` : '';
    return ask.unread ? `No new texts${from}.` : `No texts${from}${span}.`;
  }
  return list
    .map(
      (i) =>
        `${who(i.name, i.address)} (${when(i.at, now)}): ${i.body.replace(/\s+/g, ' ').slice(0, 400)}`,
    )
    .join('\n');
}

const CALL_WORD: Record<CallType, string> = {
  incoming: 'Call from',
  outgoing: 'You called',
  missed: 'Missed call from',
  rejected: 'Declined call from',
  blocked: 'Blocked call from',
  voicemail: 'Voicemail from',
  other: 'Call with',
};

function length(s: number): string {
  if (s <= 0) return '';
  if (s < 60) return `, ${s} s`;
  return `, ${Math.round(s / 60)} min`;
}

export function describeCalls(
  items: CallItem[],
  ask: Extract<TelephonyAsk, { type: 'calls' }>,
  now: number,
): string {
  let list = [...items].sort((a, b) => b.at - a.at);
  if (ask.missed) list = list.filter((c) => c.type === 'missed' || c.type === 'rejected');
  list = list.slice(0, 8);
  if (!list.length) {
    const from = ask.name ? ` from ${ask.name}` : '';
    const span = ask.range ? ` ${ask.range.label}` : '';
    return ask.missed ? `No missed calls${from}${span}.` : `No calls${from}${span}.`;
  }
  return list
    .map(
      (c) =>
        `${CALL_WORD[c.type]} ${who(c.name, c.number)}, ${when(c.at, now)}${c.type === 'incoming' || c.type === 'outgoing' ? length(c.seconds) : ''}`,
    )
    .join('\n');
}

/** The call to return: the newest call someone else made (missed first if equally new). */
export function callToReturn(items: CallItem[]): CallItem | null {
  const theirs = items
    .filter((c) => c.type !== 'outgoing' && c.type !== 'blocked' && c.number)
    .sort((a, b) => b.at - a.at);
  return theirs[0] ?? null;
}

/** The default window when nothing was said: texts 7 days, calls 3 days (unread: 30 days). */
export function defaultWindow(ask: TelephonyAsk, now: number): { from: number; to: number } {
  if (ask.type !== 'callBack' && ask.range) return { from: ask.range.from, to: ask.range.to };
  const days =
    ask.type === 'texts' ? (ask.unread ? 30 : ask.name ? 60 : 7) : ask.type === 'calls' ? 7 : 3;
  return { from: now - days * 86_400_000, to: now };
}

/**
 * Texts (SMS) on the phone: read them when asked and send approved ones directly. Google Play
 * allows the SMS permissions only for the phone's default assistant, and only while it is the
 * default, so the role is checked before asking for a permission and the native side checks it
 * again on every use (Telephony.kt). Not the assistant → the old way: messages are read from
 * notifications and new texts open Messages ready to send, plus a one-time card explaining how
 * to turn this on. Nothing read here is saved in Sidekick's memory.
 *
 * For the action router: `readTexts`, `sendTextDirect`, `telephonyStatus`, `ensureTelephony`.
 */
import { PermissionsAndroid, Platform } from 'react-native';

import { findContact } from './contacts';
import { describeThreads, readThreads } from './messages';
import { integrationsNative } from './native';
import { isOn } from './prefs';
import {
  defaultWindow,
  describeTexts,
  NO_TELEPHONY,
  type SmsItem,
  type TelephonyAsk,
  type TelephonyStatus,
} from './sms-logic';
import type { PlannedAction } from './types';
import { notices } from '@/engine/notices';

type Need = 'readSms' | 'sendSms' | 'callLog';

const PERMISSION: Record<Need, string> = {
  readSms: 'android.permission.READ_SMS',
  sendSms: 'android.permission.SEND_SMS',
  callLog: 'android.permission.READ_CALL_LOG',
};

/** What may be used right now (all false off Android or on older builds). */
export function telephonyStatus(): TelephonyStatus {
  if (Platform.OS !== 'android') return NO_TELEPHONY;
  try {
    const raw = integrationsNative()?.telephonyStatus?.();
    return raw ? { ...NO_TELEPHONY, ...(JSON.parse(raw) as TelephonyStatus) } : NO_TELEPHONY;
  } catch {
    return NO_TELEPHONY;
  }
}

const CARD_KEY = 'telephony.assistantCard.v1';

function kv() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../../modules/sidekick-native').default as {
    kvGet(k: string): string | null;
    kvSet(k: string, v: string | null): void;
    openAssistantSettings(): boolean;
  };
}

/** Once ever: a chat card explaining that texts and calls need Sidekick as the assistant. */
export function offerAssistantRole(): void {
  try {
    const native = kv();
    if (native.kvGet(CARD_KEY)) return;
    native.kvSet(CARD_KEY, String(Date.now()));
    notices.post(
      {
        key: 'telephony-assistant',
        kind: 'decision',
        text:
          'To read your texts, send them directly and tell you who called, make Sidekick your ' +
          "phone's digital assistant. Android only allows this for the assistant app; it all stays on your phone.",
        actions: [
          { label: 'Open settings', id: 'open' },
          { label: 'Not now', id: 'later' },
        ],
      },
      (id) => {
        if (id === 'open') native.openAssistantSettings();
      },
    );
  } catch {
    // No native module (tests, web): nothing to offer.
  }
}

export type Access = 'ok' | 'notAssistant' | 'denied' | 'unavailable';

/**
 * Makes [need] usable: the role must already be held (Play requires it before asking), then
 * Android's permission prompt the first time. [ask] false: never prompt, just report.
 */
export async function ensureTelephony(need: Need, ask = true): Promise<Access> {
  if (Platform.OS !== 'android' || !integrationsNative()?.telephonyStatus) return 'unavailable';
  const s = telephonyStatus();
  if (!s.assistant) {
    if (ask) offerAssistantRole();
    return 'notAssistant';
  }
  if (s[need]) return 'ok';
  if (!ask) return 'denied';
  try {
    const r = await PermissionsAndroid.request(PERMISSION[need] as never);
    return r === PermissionsAndroid.RESULTS.GRANTED ? 'ok' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Numbers to match for a spoken name ("Mum" → her phone numbers), or [] if unknown. */
async function numbersFor(name: string | null): Promise<string[]> {
  if (!name) return [];
  const c = await findContact(name).catch(() => null);
  return c?.phones ?? [];
}

/** Texts matching [ask], newest first. Null when texts can't be read (see `ensureTelephony`). */
export async function readTexts(
  ask: Extract<TelephonyAsk, { type: 'texts' }>,
  now = Date.now(),
): Promise<SmsItem[] | null> {
  const native = integrationsNative();
  if (!native?.readSms) return null;
  const { from, to } = defaultWindow(ask, now);
  const numbers = await numbersFor(ask.name);
  let items: SmsItem[];
  try {
    items = JSON.parse(native.readSms(from, to, 200, numbers.join(','))) as SmsItem[];
  } catch {
    return [];
  }
  // No contact found for the name: match the name the phone shows instead.
  if (ask.name && !numbers.length) {
    const n = ask.name.toLowerCase();
    items = items.filter((i) =>
      (i.name ?? '').toLowerCase().split(/\s+/).includes(n.split(' ')[0]),
    );
  }
  return items;
}

/** Answers a question about texts; falls back to notifications when texts can't be read. */
export async function answerTexts(
  ask: Extract<TelephonyAsk, { type: 'texts' }>,
  now = Date.now(),
): Promise<PlannedAction> {
  if (!isOn('messages', 'sms'))
    return fallbackTexts(ask, 'Reading texts is off in Settings → Connections → Messages.');
  const access = await ensureTelephony('readSms');
  if (access !== 'ok') return fallbackTexts(ask, null);
  const items = (await readTexts(ask, now)) ?? [];
  return { kind: 'reply', text: describeTexts(items, ask, now) };
}

function fallbackTexts(
  ask: Extract<TelephonyAsk, { type: 'texts' }>,
  why: string | null,
): PlannedAction {
  const native = integrationsNative();
  const seen =
    native?.notificationAccess() && isOn('messages', 'read')
      ? describeThreads(readThreads(), ask.name)
      : null;
  const note =
    why ??
    "I can't read your texts yet: make Sidekick your phone's assistant (Settings → Phone features → Digital assistant).";
  return {
    kind: 'reply',
    text: seen ? `From your notifications:\n${seen}\n(${note})` : note,
  };
}

/** Sends an approved text directly. False when not allowed (the caller opens Messages instead). */
export async function sendTextDirect(number: string, text: string): Promise<boolean> {
  if (!isOn('messages', 'sms')) return false;
  if ((await ensureTelephony('sendSms', true)) !== 'ok') return false;
  return integrationsNative()?.sendSms?.(number, text) ?? false;
}

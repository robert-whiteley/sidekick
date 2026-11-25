/**
 * Messages in other apps. Reading and replying go through the app's own notification (its reply
 * action), so nothing needs the app's login. A new conversation opens the app with the text
 * ready; in the direct-download ("full") version Sidekick can also press Send there, or send a
 * text itself. Message text from notifications is untrusted: it is read out, never obeyed.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import {
  flavour,
  integrationsNative,
  messageThreads,
  type MessageThread,
  type OpenMessageApp,
} from './native';
import { isOn } from './prefs';
import type { MessageApp, MessageFields } from './types';

export const PACKAGES: Record<OpenMessageApp, string[]> = {
  whatsapp: ['com.whatsapp', 'com.whatsapp.w4b'],
  telegram: ['org.telegram.messenger', 'org.telegram.messenger.web'],
  signal: ['org.thoughtcrime.securesms'],
  sms: ['com.google.android.apps.messaging', 'com.samsung.android.messaging', 'com.android.mms'],
};

export const APP_LABEL: Record<OpenMessageApp, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  signal: 'Signal',
  sms: 'Messages',
};

export function appForPackage(pkg: string): OpenMessageApp | null {
  for (const [app, pkgs] of Object.entries(PACKAGES))
    if (pkgs.includes(pkg)) return app as OpenMessageApp;
  return null;
}

function nameMatches(thread: MessageThread, name: string): boolean {
  const n = name.toLowerCase();
  return [thread.conversation, thread.sender].some(
    (s) => s.toLowerCase().split(/\s+/).includes(n.split(' ')[0]) || s.toLowerCase() === n,
  );
}

/** The newest chat from [name] (or the newest of all) that can be replied to. */
export function threadFor(threads: MessageThread[], name: string | null): MessageThread | null {
  const sorted = [...threads].sort((a, b) => b.at - a.at).filter((t) => t.canReply);
  return (name ? sorted.find((t) => nameMatches(t, name)) : sorted[0]) ?? null;
}

/** 'auto' → the app this person last messaged from, else Messages (SMS). */
export function chooseApp(app: MessageApp, name: string, threads: MessageThread[]): OpenMessageApp {
  if (app !== 'auto') return app;
  const t = [...threads].sort((a, b) => b.at - a.at).find((x) => nameMatches(x, name));
  return (t && appForPackage(t.pkg)) || 'sms';
}

/** "Sam on WhatsApp: see you at 6." for up to [max] chats, newest first. */
export function describeThreads(threads: MessageThread[], name: string | null, max = 5): string {
  const list = [...threads]
    .sort((a, b) => b.at - a.at)
    .filter((t) => !name || nameMatches(t, name))
    .slice(0, max);
  if (!list.length) return name ? `Nothing new from ${name}.` : 'No new messages.';
  return list
    .map((t) => {
      const who =
        t.conversation && t.conversation !== t.sender
          ? `${t.sender} in ${t.conversation}`
          : t.sender || t.conversation;
      return `${who} on ${t.app}: ${t.text.replace(/\s+/g, ' ').slice(0, 300)}`;
    })
    .join('\n');
}

export function readThreads(): MessageThread[] {
  return messageThreads(true);
}

async function allowed(permission: 'android.permission.SEND_SMS'): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

export type SendOutcome = { sent: boolean; note: string };

/** Runs an approved message draft. */
export async function sendMessage(f: MessageFields): Promise<SendOutcome> {
  const native = integrationsNative();
  if (!native) throw new Error('Messages are not available on this phone');
  if (f.replyKey) {
    if (!isOn('messages', 'reply')) throw new Error('Replies are off in Settings');
    if (native.replyToMessage(f.replyKey, f.text)) return { sent: true, note: 'Replied' };
    // The notification was dismissed: fall through to a new message.
    if (!f.to) throw new Error('That chat is no longer in your notifications');
  }
  if (!isOn('messages', 'compose')) throw new Error('New messages are off in Settings');
  const app = chooseApp(f.app, f.name, readThreads());
  const full = flavour() === 'full';
  if (app === 'sms' && full && isOn('autoSend', 'sms') && f.to) {
    if (await allowed('android.permission.SEND_SMS')) {
      if (native.sendSms(f.to, f.text)) return { sent: true, note: 'Text sent' };
    }
  }
  if (app !== 'sms' && app !== 'whatsapp' && !f.to) {
    // Telegram/Signal open their share screen; the user picks the chat.
  } else if (!f.to) {
    throw new Error(`No number for ${f.name}`);
  }
  const autoTap =
    full &&
    app === 'whatsapp' &&
    !!f.to &&
    isOn('autoSend', 'tapSend') &&
    native.accessibilityEnabled();
  if (autoTap) native.armAutoSend(PACKAGES.whatsapp[0], 10_000);
  if (!native.openMessage(app, f.to, f.text)) throw new Error(`${APP_LABEL[app]} isn't installed`);
  if (autoTap) return { sent: true, note: `Sent in ${APP_LABEL[app]}` };
  const pick = app === 'telegram' || app === 'signal' ? `pick ${f.name} and ` : '';
  return { sent: true, note: `Opened ${APP_LABEL[app]}: ${pick}tap Send there` };
}

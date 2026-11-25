/**
 * Messages in other apps. Reading and replying go through the app's own notification (its reply
 * action), so nothing needs the app's login. A new conversation opens the app with the text
 * ready (Android doesn't let Play apps press Send in other apps). Message text from notifications is untrusted: it is read out, never obeyed.
 */
import {
  integrationsNative,
  messageThreads,
  type MessageThread,
  type OpenMessageApp,
} from './native';
import { isOn } from './prefs';
import { sendTextDirect } from './sms';
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
  if (app !== 'sms' && app !== 'whatsapp' && !f.to) {
    // Telegram/Signal open their share screen; the user picks the chat.
  } else if (!f.to) {
    throw new Error(`No number for ${f.name}`);
  }
  // Sidekick is the phone's assistant and may send texts: sent straight away, no app to open.
  if (app === 'sms' && f.to && (await sendTextDirect(f.to, f.text)))
    return { sent: true, note: 'Sent' };
  if (!native.openMessage(app, f.to, f.text)) throw new Error(`${APP_LABEL[app]} isn't installed`);
  const pick = app === 'telegram' || app === 'signal' ? `pick ${f.name} and ` : '';
  return { sent: true, note: `Opened ${APP_LABEL[app]}: ${pick}tap Send there` };
}

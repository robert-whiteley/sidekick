/**
 * Call history: "who called me", "missed calls", "did Sam call", "call them back". Read only when
 * asked, only while Sidekick is the default assistant (see sms.ts for the Play rule).
 *
 * For the action router: `readCalls`, `answerCalls`, `lastCaller`.
 */
import { findContact } from './contacts';
import { integrationsNative } from './native';
import { isOn } from './prefs';
import { ensureTelephony } from './sms';
import {
  type CallItem,
  callToReturn,
  defaultWindow,
  describeCalls,
  sameNumber,
  type TelephonyAsk,
} from './sms-logic';
import type { PlannedAction } from './types';

const NEED_ROLE =
  "To tell you who called, Sidekick needs to be your phone's digital assistant (Settings → Phone features → Digital assistant).";

/** Calls in the window of [ask], newest first; null when the call log can't be read. */
export async function readCalls(ask: TelephonyAsk, now = Date.now()): Promise<CallItem[] | null> {
  const native = integrationsNative();
  if (!native?.callLog) return null;
  const { from, to } = defaultWindow(ask, now);
  let items: CallItem[];
  try {
    items = JSON.parse(native.callLog(from, to, 200)) as CallItem[];
  } catch {
    return [];
  }
  if (ask.type === 'calls' && ask.name) {
    const c = await findContact(ask.name).catch(() => null);
    const first = ask.name.toLowerCase().split(' ')[0];
    items = items.filter(
      (i) =>
        (c?.phones ?? []).some((p) => sameNumber(p, i.number)) ||
        (i.name ?? '').toLowerCase().split(/\s+/).includes(first),
    );
  }
  return items;
}

export async function answerCalls(
  ask: Extract<TelephonyAsk, { type: 'calls' }>,
  now = Date.now(),
): Promise<PlannedAction> {
  if (!isOn('calls', 'log'))
    return { kind: 'reply', text: 'Call history is off in Settings → Connections → Calls.' };
  const access = await ensureTelephony('callLog');
  if (access === 'unavailable')
    return { kind: 'reply', text: "That isn't possible on this phone." };
  if (access === 'denied')
    return { kind: 'reply', text: 'I need permission to see your call history to answer that.' };
  if (access !== 'ok') return { kind: 'reply', text: NEED_ROLE };
  const items = (await readCalls(ask, now)) ?? [];
  return { kind: 'reply', text: describeCalls(items, ask, now) };
}

/** The last call someone else made, to call back; a reply when there's none or no access. */
export async function lastCaller(
  now = Date.now(),
): Promise<{ name: string; to: string } | PlannedAction> {
  if (!isOn('calls', 'log'))
    return { kind: 'reply', text: 'Call history is off in Settings → Connections → Calls.' };
  const access = await ensureTelephony('callLog');
  if (access !== 'ok')
    return {
      kind: 'reply',
      text: access === 'denied' ? 'I need permission to see your call history first.' : NEED_ROLE,
    };
  const c = callToReturn((await readCalls({ type: 'callBack' }, now)) ?? []);
  if (!c) return { kind: 'reply', text: 'No recent calls to return.' };
  return { name: c.name || c.number, to: c.number };
}

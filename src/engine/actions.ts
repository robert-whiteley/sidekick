/**
 * Phone actions from the chat: "text Sam I'm late", "add the dentist on Friday at 3 to my
 * calendar", "set a timer for 10 minutes", "what did Jo say?".
 *
 * How the chat uses it (docs/decisions/0008-integrations.md):
 * - Before answering a question, call `planAction(question)`. null → not an action, answer as
 *   usual. `{kind:'reply'}` → say/show the text (already done, or an answer). `{kind:'draft'}`
 *   → show the draft as a card (Send / Edit / Cancel / Open in app) and say `draftSummary()`.
 * - Card Send → `runAction(draft.id)`; Edit → `drafts.update(id, fields)`; Cancel →
 *   `drafts.cancel(id)`. Saying "send it" / "cancel" goes through planAction too.
 * - Cards re-render from `drafts.subscribe` (status: draft → queued/sent/failed, with `note`).
 * - Call `startIntegrations()` once at app start: queued emails go when the phone is online,
 *   and Google Tasks sync runs (when switched on).
 * Nothing is sent to anyone without a Send tap or "send it" on a visible draft.
 */
import { PermissionsAndroid } from 'react-native';
import { parseWhen } from '@/memory/followup-logic';
import { onFollowupsChange } from '@/memory/followups';
import * as outbox from '@/memory/outbox';
import { syncGoogleTasks } from '@/integrations/google-tasks';
import { calendarAllowed, findEvent, saveEvent } from '@/integrations/calendar';
import { contactNameList, findContact } from '@/integrations/contacts';
import { gmailConfigured, OfflineError, sendGmail } from '@/integrations/gmail';
import { intentFromLlm } from '@/integrations/llm-parse';
import {
  APP_LABEL,
  chooseApp,
  describeThreads,
  readThreads,
  sendMessage,
  threadFor,
} from '@/integrations/messages';
import { integrationsNative, messageThreads, nowPlaying } from '@/integrations/native';
import { mightBeAction, parseIntent, type Intent } from '@/integrations/parse';
import { isOn } from '@/integrations/prefs';
import type { Draft, DraftKind, DraftFieldsByKind, PlannedAction } from '@/integrations/types';
import { notices } from './notices';
import { getSettings } from './settings';

export type { Draft, PlannedAction } from '@/integrations/types';

// --- Drafts shown in the chat ---

type Listener = (all: Draft[]) => void;

class Drafts {
  private items: Draft[] = [];
  private listeners = new Set<Listener>();

  all(): Draft[] {
    return this.items;
  }
  get(id: string): Draft | undefined {
    return this.items.find((d) => d.id === id);
  }
  /** The newest draft still waiting for Send ("send it" acts on this one). */
  latestOpen(): Draft | undefined {
    return [...this.items].reverse().find((d) => d.status === 'draft');
  }
  put(d: Draft) {
    this.items = [...this.items.filter((x) => x.id !== d.id), d];
    this.emit();
  }
  update<K extends DraftKind>(
    id: string,
    fields: Partial<DraftFieldsByKind[K]>,
  ): Draft | undefined {
    const d = this.get(id);
    if (!d || d.status !== 'draft') return d;
    const next = { ...d, fields: { ...d.fields, ...fields } } as Draft;
    this.put({ ...next, title: titleFor(next) } as Draft);
    return this.get(id);
  }
  cancel(id: string) {
    stopAutoSend(id);
    const d = this.get(id);
    if (d && (d.status === 'draft' || d.status === 'queued')) {
      if (d.status === 'queued') void outbox.remove(id).catch(() => {});
      this.put({ ...d, status: 'cancelled' } as Draft);
    }
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  /** Tests. */
  clear() {
    this.items = [];
  }
  private emit() {
    this.listeners.forEach((l) => l(this.items));
  }
}

export const drafts = new Drafts();

let seq = 0;
const newId = () => `draft-${Date.now().toString(36)}-${++seq}`;

function when(ms: number, allDay: boolean): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return allDay
    ? day
    : `${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function titleFor(d: Draft): string {
  switch (d.kind) {
    case 'message': {
      const f = d.fields;
      const app = f.app === 'auto' ? '' : ` (${APP_LABEL[f.app]})`;
      return `${f.replyKey ? 'Reply to' : 'Message to'} ${f.name}${app}`;
    }
    case 'email':
      return `Email to ${d.fields.name}`;
    case 'event':
      return `${d.fields.eventId ? 'Move' : 'Add'} "${d.fields.title}", ${when(d.fields.start, d.fields.allDay)}`;
    case 'call':
      return `Call ${d.fields.name}`;
  }
}

/** One sentence the assistant says with the card. */
export function draftSummary(d: Draft): string {
  const missing =
    (d.kind === 'message' && !d.fields.to && !d.fields.replyKey) ||
    (d.kind !== 'event' && d.kind !== 'message' && !d.fields.to)
      ? ` I couldn't find ${'name' in d.fields ? d.fields.name : 'them'} in your contacts, so add the ${d.kind === 'email' ? 'address' : 'number'} first.`
      : '';
  const verb =
    d.kind === 'event' ? 'Tap Add' : d.kind === 'call' ? 'Tap Call' : 'Tap Send or say "send it"';
  return `Here's the ${d.kind === 'event' ? 'event' : d.kind}. ${verb} when it looks right.${missing}`;
}

function makeDraft<K extends DraftKind>(
  kind: K,
  integration: string,
  fields: DraftFieldsByKind[K],
  now: number,
): Draft {
  const d = {
    id: newId(),
    kind,
    integration,
    fields,
    status: 'draft',
    at: now,
    title: '',
  } as unknown as Draft;
  return { ...d, title: titleFor(d) } as Draft;
}

// --- Planning ---

const off = (what: string) => ({
  kind: 'reply' as const,
  text: `${what} is off in Settings → Connections.`,
});

function needNotificationAccess(what: string): PlannedAction {
  const native = integrationsNative();
  notices.post(
    {
      key: 'integrations.notification-access',
      kind: 'decision',
      text: `To ${what}, Sidekick needs Notification access. Notifications stay on this phone.`,
      actions: [
        { label: 'Allow', id: 'open' },
        { label: 'Not now', id: 'later' },
      ],
    },
    (id) => {
      if (id === 'open') native?.openNotificationAccess();
    },
  );
  return { kind: 'reply', text: `I need Notification access to ${what}. Tap Allow below.` };
}

function notOnPhone(): PlannedAction {
  return { kind: 'reply', text: "That isn't possible on this phone yet." };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Runs actions that send nothing to anyone (alarms, media, maps) and drafts the rest. */
async function fromIntent(intent: Intent, now: Date): Promise<PlannedAction | null> {
  const native = integrationsNative();
  const t = now.getTime();
  switch (intent.type) {
    case 'sendIt': {
      const d = drafts.latestOpen();
      if (!d) return null;
      const done = await runAction(d.id);
      return {
        kind: 'reply',
        text: done.status === 'failed' ? `Not sent: ${done.note}` : (done.note ?? 'Done.'),
      };
    }
    case 'cancelIt': {
      const d = drafts.latestOpen();
      if (!d) return null;
      drafts.cancel(d.id);
      return { kind: 'reply', text: 'Cancelled.' };
    }
    case 'alarm': {
      if (!native) return notOnPhone();
      if (!isOn('alarms', 'set')) return off('Alarms and timers');
      const ok = native.setAlarm(intent.hour, intent.minute, intent.label);
      return {
        kind: 'reply',
        text: ok
          ? `Alarm set for ${pad(intent.hour)}:${pad(intent.minute)}.`
          : 'Your phone has no alarm app I can use.',
      };
    }
    case 'timer': {
      if (!native) return notOnPhone();
      if (!isOn('alarms', 'set')) return off('Alarms and timers');
      const ok = native.setTimer(intent.seconds, intent.label);
      const mins = Math.floor(intent.seconds / 60);
      const secs = intent.seconds % 60;
      const len = [
        mins ? `${mins} minute${mins === 1 ? '' : 's'}` : '',
        secs ? `${secs} seconds` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return {
        kind: 'reply',
        text: ok ? `Timer set for ${len}.` : 'Your phone has no timer app I can use.',
      };
    }
    case 'navigate': {
      if (!native) return notOnPhone();
      if (!isOn('maps', 'navigate')) return off('Directions');
      const ok = native.navigate(intent.destination, intent.mode);
      return {
        kind: 'reply',
        text: ok ? `Opening directions to ${intent.destination}.` : 'No maps app is installed.',
      };
    }
    case 'media': {
      if (!native) return notOnPhone();
      if (!isOn('media', 'control')) return off('Media control');
      if (!native.notificationAccess()) return needNotificationAccess('control music');
      const ok = native.mediaCommand(intent.cmd);
      return { kind: 'reply', text: ok ? 'Done.' : 'Nothing is playing.' };
    }
    case 'nowPlaying': {
      if (!native) return notOnPhone();
      if (!isOn('media', 'nowPlaying')) return off("Saying what's playing");
      if (!native.notificationAccess()) return needNotificationAccess("tell you what's playing");
      const np = nowPlaying();
      if (!np || !np.title) return { kind: 'reply', text: 'Nothing is playing.' };
      return {
        kind: 'reply',
        text: `${np.playing ? 'Playing' : 'Paused'}: ${np.title}${np.artist ? ` by ${np.artist}` : ''} (${np.app}).`,
      };
    }
    case 'readNotifications': {
      if (!native) return notOnPhone();
      if (!isOn('notifications', 'read')) return off('Reading notifications');
      if (!native.notificationAccess()) return needNotificationAccess('read your notifications');
      return {
        kind: 'reply',
        text: describeThreads(messageThreads(false), null, 8).replace(
          'No new messages.',
          'No notifications.',
        ),
      };
    }
    case 'readMessages': {
      if (!native) return notOnPhone();
      if (!isOn('messages', 'read')) return off('Reading messages');
      if (!native.notificationAccess()) return needNotificationAccess('read your messages');
      return { kind: 'reply', text: describeThreads(readThreads(), intent.name) };
    }
    case 'reply': {
      if (!native) return notOnPhone();
      if (!isOn('messages', 'reply')) return off('Replying to messages');
      if (!native.notificationAccess()) return needNotificationAccess('reply to messages');
      const thread = threadFor(readThreads(), intent.name);
      if (!thread) {
        if (!intent.name) return { kind: 'reply', text: 'There is no message to reply to.' };
        return fromIntent(
          { type: 'message', name: intent.name, text: intent.text, app: 'auto' },
          now,
        );
      }
      const app = chooseApp('auto', thread.sender, [thread]);
      const draft = makeDraft(
        'message',
        'messages',
        {
          name: thread.conversation || thread.sender,
          to: null,
          text: intent.text,
          app,
          replyKey: thread.key,
        },
        t,
      );
      drafts.put(draft);
      return { kind: 'draft', draft };
    }
    case 'message': {
      if (!native) return notOnPhone();
      if (!isOn('messages', 'compose')) return off('Writing messages');
      const c = await findContact(intent.name).catch(() => null);
      const draft = makeDraft(
        'message',
        'messages',
        {
          name: c?.name ?? intent.name,
          to: c?.phones[0] ?? null,
          text: intent.text,
          app: intent.app,
        },
        t,
      );
      drafts.put(draft);
      return { kind: 'draft', draft };
    }
    case 'email': {
      if (!isOn('email', 'send')) return off('Sending emails');
      const c = await findContact(intent.name).catch(() => null);
      const draft = makeDraft(
        'email',
        'email',
        {
          name: c?.name ?? intent.name,
          to: c?.emails[0] ?? null,
          subject: intent.subject,
          body: intent.body,
        },
        t,
      );
      drafts.put(draft);
      return { kind: 'draft', draft };
    }
    case 'call': {
      if (!native) return notOnPhone();
      const c = await findContact(intent.name).catch(() => null);
      const draft = makeDraft(
        'call',
        'calls',
        { name: c?.name ?? intent.name, to: c?.phones[0] ?? null },
        t,
      );
      drafts.put(draft);
      return { kind: 'draft', draft };
    }
    case 'event': {
      if (!isOn('calendar', 'write')) return off('Adding events');
      const draft = makeDraft(
        'event',
        'calendar',
        {
          title: intent.title,
          start: intent.start,
          end: intent.end,
          allDay: intent.allDay,
          location: intent.location,
        },
        t,
      );
      drafts.put(draft);
      return { kind: 'draft', draft };
    }
  }
}

/** "Move the dentist to 4pm" / "reschedule lunch with Jo to Friday". */
async function moveEvent(question: string, now: Date): Promise<PlannedAction | null> {
  const m =
    /^(?:please )?(?:move|reschedule|push|change|shift) (?:my |the )?(.+?) (?:to|until|till) (.+?)[.!?]*$/i.exec(
      question.trim(),
    );
  if (!m || !isOn('calendar', 'write')) return null;
  const to = parseWhen(m[2], now);
  if (!to) return null;
  if (!(await calendarAllowed(true)))
    return { kind: 'reply', text: 'I need Calendar access to change events.' };
  const ev = await findEvent(
    m[1].replace(/^(appointment|meeting|event) (with |for )?/i, ''),
    now.getTime(),
  );
  if (!ev) return null;
  const len = ev.end - ev.start;
  const start =
    to.allDay && !ev.allDay
      ? new Date(
          new Date(to.at).setHours(new Date(ev.start).getHours(), new Date(ev.start).getMinutes()),
        ).getTime()
      : to.at;
  const draft = makeDraft(
    'event',
    'calendar',
    {
      title: ev.title,
      start,
      end: start + len,
      allDay: ev.allDay,
      location: ev.location,
      eventId: ev.id,
    },
    now.getTime(),
  );
  drafts.put(draft);
  return { kind: 'draft', draft };
}

/**
 * Is [question] a phone action? Rules first (instant); the model only for action-like wording
 * the rules miss, and only when `useModel` (default true).
 */
export async function planAction(
  question: string,
  opts: { now?: Date; useModel?: boolean } = {},
): Promise<PlannedAction | null> {
  const now = opts.now ?? new Date();
  const contacts = /\b(text|message|tell|email|e-mail|whatsapp|reply|let)\b/i.test(question)
    ? await contactNameList()
    : [];
  const intent = parseIntent(question, now, contacts);
  if (intent) return fromIntent(intent, now);
  const moved = await moveEvent(question, now).catch(() => null);
  if (moved) return moved;
  if (opts.useModel === false || !mightBeAction(question)) return null;
  const guessed = await intentFromLlm(question, now);
  return guessed ? fromIntent(guessed, now) : null;
}

// --- Running an approved draft ---

function finish(d: Draft, status: Draft['status'], note: string): Draft {
  const next = { ...d, status, note } as Draft;
  drafts.put(next);
  return next;
}

/** Runs the draft the user approved (Send / Add / Call). Never throws; see status + note. */
/** The countdown before a draft sends by itself (Settings > Connections > Sending). */
export const AUTO_SEND_MS = 5000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function stopAutoSend(id: string) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

/**
 * Applies the sending setting to a new draft: 'instant' runs it now, 'countdown' (default) runs
 * it after AUTO_SEND_MS unless cancelled or edited, 'ask' waits for Send.
 */
export function autoSend(
  id: string,
  mode: 'countdown' | 'instant' | 'ask' = getSettings().actionSend ?? 'countdown',
  now = Date.now(),
): void {
  const d = drafts.get(id);
  if (!d || d.status !== 'draft' || mode === 'ask') return;
  // Without a resolved recipient it can't go anywhere: leave it for the user to fix.
  if ((d.kind === 'message' || d.kind === 'email' || d.kind === 'call') && !d.fields.to) return;
  if (mode === 'instant') return void runAction(id);
  drafts.put({ ...d, sendAt: now + AUTO_SEND_MS } as Draft);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      const cur = drafts.get(id);
      if (cur?.status === 'draft' && cur.sendAt) void runAction(id);
    }, AUTO_SEND_MS),
  );
}

/** Editing a draft stops its countdown: the user is taking over. */
export function holdDraft(id: string) {
  stopAutoSend(id);
  const d = drafts.get(id);
  if (d?.sendAt) drafts.put({ ...d, sendAt: undefined } as Draft);
}

export async function runAction(id: string): Promise<Draft> {
  stopAutoSend(id);
  const d = drafts.get(id);
  if (!d) throw new Error('No such draft');
  if (d.status !== 'draft' && d.status !== 'failed') return d;
  try {
    switch (d.kind) {
      case 'message': {
        const r = await sendMessage(d.fields);
        return finish(d, 'sent', r.note);
      }
      case 'email': {
        if (!d.fields.to) return finish(d, 'failed', `No email address for ${d.fields.name}`);
        if (!gmailConfigured()) return finish(d, 'failed', 'Email sending is not set up yet');
        try {
          await sendGmail(d.fields);
          return finish(d, 'sent', 'Email sent');
        } catch (e) {
          if (!(e instanceof OfflineError)) throw e;
          await outbox.enqueue(d.id, JSON.stringify(d));
          return finish(d, 'queued', 'Waiting for internet; it sends by itself');
        }
      }
      case 'event': {
        await saveEvent(d.fields);
        return finish(d, 'sent', d.fields.eventId ? 'Event moved' : 'Added to your calendar');
      }
      case 'call': {
        const native = integrationsNative();
        if (!native) return finish(d, 'failed', 'Calls are not possible on this phone');
        if (!d.fields.to) return finish(d, 'failed', `No number for ${d.fields.name}`);
        let direct = isOn('calls', 'direct');
        if (direct) {
          const p = 'android.permission.CALL_PHONE' as const;
          direct =
            (await PermissionsAndroid.check(p)) ||
            (await PermissionsAndroid.request(p)) === 'granted';
        }
        if (!native.call(d.fields.to, direct)) return finish(d, 'failed', 'No phone app');
        return finish(d, 'sent', direct ? 'Calling' : 'Opened the dialler: tap Call');
      }
    }
  } catch (e) {
    return finish(d, 'failed', e instanceof Error ? e.message : String(e));
  }
}

// --- Outbox ---

/** Sends everything queued; returns how many went. */
export async function flushOutbox(): Promise<number> {
  let sent = 0;
  for (const row of await outbox.pending()) {
    let d: Draft;
    try {
      d = JSON.parse(row.draft) as Draft;
    } catch {
      await outbox.remove(row.id);
      continue;
    }
    if (d.kind !== 'email') {
      await outbox.remove(row.id);
      continue;
    }
    if (!drafts.get(d.id)) drafts.put({ ...d, status: 'queued' } as Draft);
    try {
      await sendGmail(d.fields);
      await outbox.remove(row.id);
      finish(d, 'sent', 'Email sent');
      sent++;
    } catch (e) {
      if (e instanceof OfflineError) break;
      const msg = e instanceof Error ? e.message : String(e);
      await outbox.noteFailure(row.id, msg);
      if (row.tries + 1 >= 5) {
        await outbox.remove(row.id);
        finish(d, 'failed', msg);
      }
    }
  }
  return sent;
}

const TASK_SYNC_MS = 15 * 60_000;

/**
 * Call once at app start: shows queued items and sends them whenever the phone comes online,
 * and keeps Google Tasks in step (when that switch is on): on start, when back online, shortly
 * after any to-do change, and every 15 minutes while the app runs.
 */
export function startIntegrations(): () => void {
  let stopped = false;
  let sub: { remove(): void } | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const sync = () => {
    if (!stopped) void syncGoogleTasks().catch(() => {});
  };
  const timer = setInterval(sync, TASK_SYNC_MS);
  const offFollowups = onFollowupsChange(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(sync, 30_000);
  });
  void (async () => {
    try {
      const Network = await import('expo-network');
      if (stopped) return;
      const state = await Network.getNetworkStateAsync();
      if (state.isInternetReachable !== false && state.isConnected) {
        await flushOutbox();
        sync();
      } else {
        for (const row of await outbox.pending()) {
          try {
            const d = JSON.parse(row.draft) as Draft;
            if (!drafts.get(d.id))
              drafts.put({ ...d, status: 'queued', note: 'Waiting for internet' } as Draft);
          } catch {}
        }
      }
      sub = Network.addNetworkStateListener((s) => {
        if (s.isConnected && s.isInternetReachable !== false) {
          void flushOutbox().catch(() => {});
          sync();
        }
      });
    } catch {
      // No network module (tests/web): nothing to do.
    }
  })();
  return () => {
    stopped = true;
    sub?.remove();
    clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    offFollowups();
  };
}

/** Old name. */
export const startOutbox = startIntegrations;

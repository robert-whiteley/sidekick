import { createEventInCalendarAsync, requestCalendarPermissionsAsync } from 'expo-calendar/legacy';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { type Draft, setScheduledSendNotifier } from './actions';
import { briefingText } from './hands-free-logic';
import { eventsBetween } from '@/integrations/calendar';
import { digestText, type Followup } from '@/memory/followup-logic';
import { listFollowups, onFollowupsChange, rollRepeats } from '@/memory/followups';
import { repeatTriggers } from '@/memory/repeat-logic';

/**
 * Local notifications for approved reminders (the daily briefing is now a routine: routines.ts). Everything is
 * scheduled on the phone by the OS (no push, no server). The schedule is rebuilt from the
 * database after every change, so it can never drift from what the user approved.
 */
const CHANNEL = 'followups';
const TAG = 'sidekick-followup';
/** iOS keeps at most 64 pending notifications per app. */
const MAX_SCHEDULED = 50;

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Reminders',
    importance: AndroidImportance.HIGH,
  });
}

/** Asks for notification permission (only when the user approves a reminder or sets up a routine). */
export async function askNotificationPermission(): Promise<boolean> {
  await ensureChannel(); // Android 13+ shows the prompt only once a channel exists
  const now = await Notifications.getPermissionsAsync();
  if (now.granted) return true;
  if (!now.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Android 12+: without "Alarms & reminders" access reminders may arrive a few minutes late. */
export async function exactRemindersAllowed(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  return (await Notifications.getExactAlarmPermissionsAsync()).granted;
}

export async function allowExactReminders(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  return (await Notifications.requestExactAlarmPermissionsAsync()).granted;
}

let chain: Promise<void> = Promise.resolve();

/** Rebuilds every Sidekick notification from the approved follow-ups. */
export function syncFollowupNotifications(): Promise<void> {
  chain = chain
    .then(sync)
    .catch((e) => console.log(`[followups] notify sync failed: ${String(e)}`));
  return chain;
}

async function sync() {
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await ensureChannel();
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of pending) {
    if (n.content.data?.tag === TAG)
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
  }
  await rollRepeats();
  const items = await listFollowups();
  const now = Date.now();
  const approved = items.filter(
    (f) => f.status === 'approved' && f.kind === 'reminder' && f.dueAt != null,
  );
  // Recurring reminders repeat by themselves (DAILY / WEEKLY triggers).
  let left = MAX_SCHEDULED;
  for (const f of approved.filter((x) => x.repeat)) {
    for (const t of repeatTriggers(f.repeat!, f.dueAt!)) {
      if (left-- <= 0) break;
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Reminder', body: f.title, data: { tag: TAG, followupId: f.id } },
        trigger:
          t.type === 'daily'
            ? {
                type: Notifications.SchedulableTriggerInputTypes.DAILY,
                hour: t.hour,
                minute: t.minute,
                channelId: CHANNEL,
              }
            : {
                type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
                weekday: t.weekday,
                hour: t.hour,
                minute: t.minute,
                channelId: CHANNEL,
              },
      });
    }
  }
  const due = approved
    .filter((f) => !f.repeat && f.dueAt! > now)
    .sort((a, b) => a.dueAt! - b.dueAt!)
    .slice(0, Math.max(0, left));
  for (const f of due) await schedule('Reminder', f.title, f.dueAt!, f.id);
}

async function schedule(title: string, body: string, at: number, id: number | null) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { tag: TAG, followupId: id } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: CHANNEL,
    },
  });
}

// --- Scheduled sends: a notification at the time opens Sidekick, which sends it ---

const SEND_TAG = 'sidekick-scheduled-send';

async function scheduleSend(d: Draft) {
  if (!d.scheduledAt || !(await askNotificationPermission())) return;
  const who = 'name' in d.fields ? d.fields.name : '';
  await Notifications.scheduleNotificationAsync({
    identifier: `send-${d.id}`,
    content: {
      title: d.kind === 'email' ? `Email to ${who}` : `Message to ${who}`,
      body: "It's due now: open Sidekick if it hasn't gone yet.",
      data: { tag: SEND_TAG, draftId: d.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: d.scheduledAt,
      channelId: CHANNEL,
    },
  });
}

async function cancelSend(id: string) {
  await Notifications.cancelScheduledNotificationAsync(`send-${id}`);
}

/** The briefing text for today (calendar, due to-dos, follow-ups), or null. */
export async function todaysBriefing(now = new Date()): Promise<string | null> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [items, events] = await Promise.all([
    listFollowups(),
    eventsBetween(dayStart, dayStart + 86_400_000).catch(() => []),
  ]);
  return briefingText(events, digestText(items, now), now);
}

let started = false;
/** Keeps notifications in step with follow-ups and settings. Call once at startup. */
export function startFollowupNotifications() {
  if (started) return;
  started = true;
  setScheduledSendNotifier({ schedule: scheduleSend, cancel: cancelSend });
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  onFollowupsChange(() => void syncFollowupNotifications());
  void syncFollowupNotifications();
}

/**
 * Opens the phone's own "new event" screen pre-filled; nothing is saved unless the user taps
 * Save there. Needs no calendar permission on Android or iOS 17+.
 */
export async function addToCalendar(f: Pick<Followup, 'title' | 'dueAt' | 'allDay'>) {
  if (f.dueAt == null) throw new Error('Set a time first.');
  const start = new Date(f.dueAt);
  if (f.allDay) start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + (f.allDay ? 86_400_000 : 3_600_000));
  const event = { title: f.title, startDate: start, endDate: end, allDay: f.allDay };
  try {
    await createEventInCalendarAsync(event);
  } catch (e) {
    // iOS 16 and older need calendar access before showing the screen.
    if (Platform.OS !== 'ios' || !(await requestCalendarPermissionsAsync()).granted) throw e;
    await createEventInCalendarAsync(event);
  }
}

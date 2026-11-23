import { createEventInCalendarAsync, requestCalendarPermissionsAsync } from 'expo-calendar/legacy';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { getSettings, onSettingsChange } from './settings';
import { digestText, type Followup } from '@/memory/followup-logic';
import { listFollowups, onFollowupsChange } from '@/memory/followups';

/**
 * Local notifications for approved reminders and the optional morning digest. Everything is
 * scheduled on the phone by the OS (no push, no server). The schedule is rebuilt from the
 * database after every change, so it can never drift from what the user approved.
 */
const CHANNEL = 'followups';
const TAG = 'sidekick-followup';
/** iOS keeps at most 64 pending notifications per app. */
const MAX_SCHEDULED = 50;
const DIGEST_DAYS = 3;

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Reminders',
    importance: AndroidImportance.HIGH,
  });
}

/** Asks for notification permission (only when the user approves a reminder or turns on the digest). */
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
  const items = await listFollowups();
  const now = Date.now();
  const due = items
    .filter(
      (f) => f.status === 'approved' && f.kind === 'reminder' && f.dueAt != null && f.dueAt > now,
    )
    .sort((a, b) => a.dueAt! - b.dueAt!)
    .slice(0, MAX_SCHEDULED - DIGEST_DAYS);
  for (const f of due) await schedule('Reminder', f.title, f.dueAt!, f.id);

  const s = getSettings();
  if (!s.followupDigest) return;
  for (let i = 0; i < DIGEST_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    d.setHours(s.digestHour, 0, 0, 0);
    if (d.getTime() <= now) continue;
    const body = digestText(items, d);
    if (body) await schedule('Your day', body, d.getTime(), null);
  }
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

let started = false;
/** Keeps notifications in step with follow-ups and settings. Call once at startup. */
export function startFollowupNotifications() {
  if (started) return;
  started = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  onFollowupsChange(() => void syncFollowupNotifications());
  let digest = getSettings().followupDigest;
  let hour = getSettings().digestHour;
  onSettingsChange((s) => {
    if (s.followupDigest === digest && s.digestHour === hour) return;
    digest = s.followupDigest;
    hour = s.digestHour;
    void syncFollowupNotifications();
  });
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

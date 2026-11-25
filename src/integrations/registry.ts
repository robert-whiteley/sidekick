/**
 * Every phone integration and its switches, for Settings → Connections (one row each, with its
 * own switches). Values live in prefs.ts. `needs` is shown under the row when the integration
 * can't run yet ("Needs Notification access").
 */

export type IntegrationSwitch = { id: string; label: string; default: boolean };

export type Integration = {
  id: string;
  name: string;
  /** One plain sentence for the Settings row. */
  description: string;
  switches: IntegrationSwitch[];
  androidOnly?: boolean;
  needs?: string;
  /**
   * Uses the optional Google sign-in: hidden as "Not set up yet" until the OAuth client id is
   * configured (google.ts googleConfigured). Turning its switch on must go through
   * `connectGoogle(feature)`, which asks Google for just that scope first.
   */
  google?: 'gmail' | 'tasks' | 'drive';
};

export const INTEGRATIONS: Integration[] = [
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Answer from your calendar and add or change events after you confirm.',
    switches: [
      { id: 'read', label: 'Read my calendar', default: true },
      { id: 'write', label: 'Add and change events', default: true },
    ],
    needs: 'Calendar permission (asked the first time)',
  },
  {
    id: 'alarms',
    name: 'Alarms and timers',
    description: 'Set alarms and timers in your Clock app.',
    switches: [{ id: 'set', label: 'Set alarms and timers', default: true }],
    androidOnly: true,
  },
  {
    id: 'phone',
    name: 'Phone controls',
    description:
      'Open apps, torch, volume, Do Not Disturb, brightness, and "play X on Spotify". Wi-Fi, Bluetooth, mobile data and airplane mode open their switch: Android doesn’t let apps flip them.',
    switches: [
      { id: 'apps', label: 'Open apps by name', default: true },
      { id: 'torch', label: 'Torch', default: true },
      { id: 'volume', label: 'Volume', default: true },
      { id: 'dnd', label: 'Do Not Disturb', default: true },
      { id: 'brightness', label: 'Screen brightness', default: true },
      { id: 'panels', label: 'Open Wi-Fi, Bluetooth, data and airplane switches', default: true },
      { id: 'play', label: 'Play songs, albums and podcasts by name', default: true },
    ],
    androidOnly: true,
    needs: 'Do Not Disturb access and "Modify system settings" (asked the first time)',
  },
  {
    id: 'contacts',
    name: 'Contacts',
    description: 'Find numbers and email addresses for the people you name.',
    switches: [{ id: 'read', label: 'Look up contacts', default: true }],
    needs: 'Contacts permission (asked the first time)',
  },
  {
    id: 'calls',
    name: 'Phone calls',
    description: 'Call someone after you tap Call.',
    switches: [{ id: 'direct', label: 'Call straight away (no dialler step)', default: true }],
    androidOnly: true,
    needs: 'Phone permission for straight-away calls (asked the first time)',
  },
  {
    id: 'maps',
    name: 'Maps and directions',
    description: 'Start directions in your maps app.',
    switches: [{ id: 'navigate', label: 'Open directions', default: true }],
  },
  {
    id: 'media',
    name: 'Music and media',
    description: "Play, pause, skip, and tell you what's playing.",
    switches: [
      { id: 'control', label: 'Control playback', default: true },
      { id: 'nowPlaying', label: "Say what's playing", default: true },
    ],
    androidOnly: true,
    needs: 'Notification access',
  },
  {
    id: 'notifications',
    name: 'Notifications',
    description:
      'Read your notifications to you when you ask. Nothing is kept unless you turn on the memory source.',
    switches: [{ id: 'read', label: 'Read notifications when asked', default: true }],
    androidOnly: true,
    needs: 'Notification access',
  },
  {
    id: 'messages',
    name: 'Messages',
    description:
      'WhatsApp, Messages, Telegram, Signal: read new messages, reply from the chat, start new conversations.',
    switches: [
      { id: 'read', label: 'Read new messages when asked', default: true },
      { id: 'reply', label: 'Reply from Sidekick (through the notification)', default: true },
      { id: 'compose', label: 'Write new messages (opens the app ready to send)', default: true },
    ],
    androidOnly: true,
    needs: 'Notification access for reading and replying',
  },
  {
    id: 'email',
    name: 'Email (Gmail)',
    description: 'Send emails you approve from your Gmail account. Sidekick cannot read your mail.',
    switches: [{ id: 'send', label: 'Send emails from Sidekick', default: true }],
    androidOnly: true,
    needs: 'Sign in with Google the first time you send',
    google: 'gmail',
  },
  {
    id: 'googleTasks',
    name: 'Google Tasks',
    description:
      'Keep your Sidekick to-dos and reminders in step with Google Tasks, both ways. Sends only the to-do titles, dates and done state.',
    switches: [{ id: 'sync', label: 'Sync with Google Tasks', default: false }],
    androidOnly: true,
    needs: 'Sign in with Google',
    google: 'tasks',
  },
  {
    id: 'driveBackup',
    name: 'Google Drive backup',
    description:
      'Save your Sidekick export to your Google Drive. Sidekick can only see the backup files it made.',
    switches: [{ id: 'backup', label: 'Back up to Google Drive', default: false }],
    androidOnly: true,
    needs: 'Sign in with Google',
    google: 'drive',
  },
];

export function integration(id: string): Integration | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

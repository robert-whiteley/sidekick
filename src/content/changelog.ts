/**
 * What's new, one entry per released version, newest first. Plain words, written for users.
 * Shown in the app (/whats-new, once after an update) and used for the Google Play
 * "What's new" text (scripts/changelog.mjs writes fastlane/metadata/.../changelogs/).
 * scripts/release.sh adds new entries at the top; keep this file plain data (no imports).
 */

export type ChangelogEntry = {
  /** The app version users see (app.json "version"), e.g. "1.0.1". */
  version: string;
  /** Release date, YYYY-MM-DD. */
  date: string;
  /** Short lines, one change each. */
  items: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  // NEXT ENTRY (scripts/changelog.mjs inserts here)
  {
    version: '1.0.0',
    date: '2026-11-25',
    items: [
      'First release: a private helper that runs on your phone and works offline.',
      'Ask by voice or typing; answers are spoken and shown in the chat.',
      'Remembers what you see and hear, so you can ask about it later.',
      'Reminders, to-dos and message drafts, each waiting for your OK.',
      'Online lookup is off until you turn it on.',
    ],
  },
];

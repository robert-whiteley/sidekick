# 8. Phone integrations and the two builds

Date: 2026-11-25

## What Sidekick can do in other apps

| Integration        | How                                                                                                                       | Sends without a tap?                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Calendar           | expo-calendar: add / move events after the user taps Add on a card; reading stays the calendar source                     | No                                       |
| Alarms and timers  | `AlarmClock.ACTION_SET_ALARM` / `ACTION_SET_TIMER` with skip-UI, done at once                                             | n/a (nothing sent to anyone)             |
| Contacts           | expo-contacts, read only, to find numbers and addresses                                                                   | n/a                                      |
| Calls              | Card → Call: `ACTION_CALL` (CALL_PHONE, asked on first use) or `ACTION_DIAL` if declined/switched off                     | No                                       |
| Maps               | `google.navigation:` (Google Maps), else `geo:` for any maps app; transit via a Maps directions URL                       | n/a                                      |
| Media              | MediaSession controllers through the notification listener: play/pause/next/previous, what's playing                      | n/a                                      |
| Notifications      | Notification listener, live (nothing stored unless the memory source is on); read out on request                          | n/a                                      |
| Messages: read     | Same listener; MessagingStyle gives sender, chat and the last lines                                                       | n/a                                      |
| Messages: reply    | Draft card → Send → the notification's own RemoteInput reply action                                                       | No                                       |
| Messages: new chat | Draft card → Send → WhatsApp (`wa.me` link), Messages (`smsto:`), Telegram/Signal (share screen) open with the text ready | No (Play: user taps Send in the app too) |
| Email              | Draft card → Send → Gmail API `users.messages.send`, token from Google's Authorization API                                | No                                       |
| Google Tasks       | Optional switch (off by default): two-way sync of approved to-dos/reminders with the default Google Tasks list            | n/a                                      |
| Drive backup       | Optional switch (off by default): uploads the export zip to Drive, replacing the previous backup                          | n/a                                      |
| Full build only    | Direct SMS (SmsManager) and an Accessibility service that presses WhatsApp's Send once after approval                     | No                                       |

Every integration has its own switches (`src/integrations/registry.ts`, Settings → Connections).
Rules read common requests instantly (`src/integrations/parse.ts`); action-like wording the rules
miss goes to Gemma in a throwaway chat (`llm-parse.ts`), which only fills a draft. Message and
notification text from other apps is untrusted: it is read out, never fed to the model as
instructions.

Offline: WhatsApp, Messages, Telegram and Signal queue their own sends, so hand-offs happen at
once. An approved email with no connection waits in the `outbox` table (`src/memory/outbox.ts`),
is shown on its card as "Waiting for internet" and sends itself when the phone is online.

## Two builds

`plugins/with-flavours.js` adds Gradle product flavours `play` and `full`:

- **play** (Google Play, default): no SEND_SMS, no Accessibility service.
- **full** (direct-download APK): adds `android/app/src/full/AndroidManifest.xml` with SEND_SMS,
  the `AutoSendService` Accessibility service and `sidekick.flavour = full` meta-data.

Builds: `./gradlew assemblePlayRelease` / `assembleFullRelease` (`bundlePlayRelease` for the
store). EAS: `production` → `:app:bundlePlayRelease`, `preview` → `:app:assembleFullRelease`.
Same application id for both, so a phone runs one or the other.

## Permissions and Play policy

| Permission / access                                        | Build | Why it is allowed                                                                                                                                                                                                |
| ---------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| READ_CALENDAR, WRITE_CALENDAR                              | both  | Normal runtime permissions; used to answer and to add events the user approved. WRITE_CALENDAR is no longer blocked in app.json.                                                                                 |
| READ_CONTACTS                                              | both  | Runtime permission, read only. WRITE_CONTACTS stays blocked.                                                                                                                                                     |
| CALL_PHONE                                                 | both  | Phone group, not the restricted Call Log group; only after the user taps Call.                                                                                                                                   |
| com.android.alarm.permission.SET_ALARM                     | both  | Normal permission for the Clock intents.                                                                                                                                                                         |
| Notification listener                                      | both  | Special access the user grants in system settings; core use (reading and replying to messages, media). Needs Play's prominent in-app disclosure, given on the decision card before opening the setting.          |
| `<queries>` for WhatsApp, Telegram, Signal, Maps, Messages | both  | Package visibility for named apps only (no QUERY_ALL_PACKAGES).                                                                                                                                                  |
| SEND_SMS                                                   | full  | Play allows the SMS group only for the default SMS/assistant handler, so it is left out of the Play build.                                                                                                       |
| Accessibility service                                      | full  | Play's Accessibility API policy bars non-accessibility apps from using it to carry out actions, so it exists only in the APK. Android 13+ makes the user allow "restricted settings" for a sideloaded app first. |
| gmail.send (OAuth scope)                                   | both  | A Google "sensitive" scope: free Google verification before more than 100 users. Read scopes are "restricted" (paid yearly assessment), so mail is never read; incoming mail comes from notifications.           |

Sources: Play Console Help "Use of SMS or Call Log permission groups" (answer 9047303), "Use of
the AccessibilityService API" (answer 10964491), Android "Authorize access to Google user data"
(developer.android.com/identity/authorization).

## Owner step: Google sign-in (Gmail, Tasks, Drive)

Inactive until done (the card says "Email sending is not set up yet"):

1. Google Cloud console → new project → enable the Gmail API, Google Tasks API and Google Drive API.
2. OAuth consent screen: External, app name Sidekick, scopes `.../auth/gmail.send`,
   `.../auth/tasks` and `.../auth/drive.file`; add your own
   account as a test user (up to 100 test users work before verification).
3. Credentials → OAuth client ID → Android: package `app.ondevice.sidekick` and the SHA-1 of
   each signing key (local release keystore, EAS key, Play app-signing key).
4. Put the client ID in `app.json` → `expo.extra.google.androidClientId` and rebuild.
5. Before a public release: submit the consent screen for verification (free for sensitive
   scopes).

## Google scopes: incremental, with text for Google's verification form

Each scope is asked for only when its switch is first turned on (`connectGoogle(feature)` in
`src/integrations/google.ts`; Google's consent screen then names just that scope). Tokens stay
on the phone; there is no Sidekick server. None is a "restricted" scope, so no paid security
assessment; `gmail.send` and `tasks` are "sensitive" (free verification), `drive.file` is
non-sensitive.

- **gmail.send:** "Sidekick is an on-device assistant. When the user asks it to email someone,
  it shows the drafted email in the app; only after the user taps Send does Sidekick send that
  one email from the user's Gmail account. Sidekick never reads, lists or deletes mail and has
  no server; the token is used only on the user's phone."
- **tasks:** "When the user turns on Google Tasks sync, Sidekick keeps the to-dos and reminders
  the user approved in the app in step with their default Google Tasks list, both ways (title,
  due date, done). It reads and writes only tasks in that list, on the user's phone, with no
  server."
- **drive.file:** "When the user turns on Drive backup, Sidekick uploads the backup file the
  user exported from the app to the user's Drive, replacing its previous backup. With
  drive.file it can see only files it created itself; it never reads other Drive files."

## Left out

- Reading Gmail through the API (restricted scope, paid assessment) → notifications instead.
- Prefilling a Telegram or Signal chat with a specific person: neither app has a supported
  link for "this number + this text"; their share screen is used and the user picks the chat.
- Auto-send in Telegram and Signal (full build): the chat is picked by the user, so there is no
  safe single Send to press.
- An in-app SMS app (becoming the default SMS handler) to send texts on Play: too much scope.

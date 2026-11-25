# Google Play Data safety form — answers

Play Console → App content → Data safety. Google's definitions: data is **collected** when it is sent off the device (to the developer or a third party); processing only on the device is not collection. Data sent **directly from the phone to a service at the user's request**, where the user expects it, is handled as below. Checked against the code on 25 Nov 2026 (network touch points: see the end).

## Overview questions

| Question                                                              | Answer                                                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Does your app collect or share any of the required user data types?   | **No**                                                                                                                        |
| Is all of the user data collected by your app encrypted in transit?   | (not asked when "No"; all connections are HTTPS anyway)                                                                       |
| Do you provide a way for users to request that their data is deleted? | Not asked when "No". In-app: Settings → Privacy → Delete; uninstall deletes everything; https://sidekick.sashy.ai/delete-data |

Why "No" is correct:

- **Nothing reaches the developer.** There is no server, account, analytics, crash reporting or ads SDK. Full app updates come through Google Play, and Firebase push is not used (`enableRemoteNotifications` off).
- **Model downloads** (Hugging Face, GitHub) are plain file downloads with no user data.
- **Quick fixes** (expo-updates, "Get quick fixes" on by default, Wi-Fi only, at most every 6 h): the request to Expo carries only runtime version, platform, channel and current update id — app info, not user data. Off means no request at all.
- **Online lookup** (off by default) sends a few search words to Wikipedia, DuckDuckGo, GDELT and an optional user-chosen SearXNG server, and downloads Wikipedia current-events pages and user-added RSS feeds. Google's guidance excludes data sent to a third party "based on a specific user-initiated action where the user reasonably expects the data to be shared", and the user turns it on and asks the question. The search words have names taken out and carry no identifiers.
- **Optional Google sign-in** (Gmail send, Google Tasks, Drive backup) goes directly from the phone to Google's APIs, started by the user for that feature. It does not reach the developer. The email, to-dos and backup file are sent at the user's explicit request (the user approves each email; turns on Tasks sync; turns on backup), which is the same user-initiated exception.
- **Weather** (only with online lookup on, when the user asks about the weather): the phone's location rounded to 2 decimals (~1 km) is sent to MET Norway (api.met.no), the same user-initiated exception. Location itself (opt-in) stays on the phone; place names come from a list built into the app.
- **Messages and calls** are handed to the phone's own apps (Messages, WhatsApp, Phone) through intents. Sidekick does not send them itself.

If the reviewer disagrees about Google features or weather, the fallback is to declare these data types under **Shared**, _user-initiated_, _optional_, purpose **App functionality**, with no "Collected":

- Personal info → Email address (the Google account used to sign in)
- Messages → Emails (the approved email body, sent through Gmail)
- Files and docs (the backup export, uploaded to the user's Drive)
- App activity → Other user-generated content (to-dos synced with Google Tasks)
- Location → Approximate location (rounded, sent to MET Norway for a weather question)

## Security practices section

- Data encrypted in transit: Yes (HTTPS only; RSS feeds must be https).
- Users can request deletion: Yes, in the app (Settings → Privacy: delete an item, a person, a time range or everything), and uninstalling deletes all of it.
- Independent security review: No.
- Committed to the Play Families Policy: No (not a children's app).

## Network touch points (audit, 25 Nov 2026)

| Where                                              | Host                                                                                 | When                                                                                                                                  | Sends                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `src/engine/models.ts`, `modules/.../Downloads.kt` | huggingface.co, github.com, raw.githubusercontent.com                                | First run (on Wi-Fi, or after the user agrees to use mobile data); better-model updates (default Wi-Fi + charging; Settings → Models) | File requests only                                     |
| `src/web/lookup.ts`                                | en.wikipedia.org, api.duckduckgo.com, user SearXNG                                   | Online lookup on (default off) and a general question                                                                                 | Search words, names taken out                          |
| `src/web/news-logic.ts`                            | api.gdeltproject.org, en.wikipedia.org (Current events), user RSS/Atom feeds (https) | Online lookup on and a news question                                                                                                  | GDELT: search words; others: plain page/feed downloads |
| `src/integrations/gmail.ts`                        | gmail.googleapis.com                                                                 | Email switch on, user approves an email                                                                                               | The approved email                                     |
| `src/integrations/google-tasks.ts`                 | tasks.googleapis.com                                                                 | Google Tasks switch on                                                                                                                | To-dos                                                 |
| `src/integrations/drive-backup.ts`                 | www.googleapis.com (Drive upload)                                                    | Drive backup switch on, a backup runs                                                                                                 | The export file                                        |
| Weather lookup (`src/web/weather.ts`)              | api.met.no                                                                           | Online lookup on and a weather question                                                                                               | Location rounded to ~1 km                              |
| Street names (`src/engine/location.ts`)            | Android Geocoder (Google)                                                            | Online lookup on and a "where am I" question                                                                                          |
| `src/engine/quick-fixes.ts` (expo-updates)         | u.expo.dev                                                                           | "Get quick fixes" on (default), Wi-Fi, at most every 6 h                                                                              |
| Google sign-in (native)                            | accounts.google.com via Google Play services                                         | When a Google switch is first turned on                                                                                               | Standard OAuth                                         |
| "Search the web in your browser" link              | duckduckgo.com in the browser                                                        | Only when tapped                                                                                                                      | Search words (in the browser)                          |

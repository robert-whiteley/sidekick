# Google OAuth verification (sensitive scopes)

Google sign-in is optional and asks for one scope per feature, the first time that feature is turned on (incremental authorization; ADR 0008). Scopes (`src/integrations/google.ts`):

| Scope                                        | Google's class              | Feature                                                               |
| -------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `https://www.googleapis.com/auth/gmail.send` | Sensitive                   | Send an email the user has approved                                   |
| `https://www.googleapis.com/auth/tasks`      | Sensitive                   | Two-way sync of Sidekick to-dos with Google Tasks                     |
| `https://www.googleapis.com/auth/drive.file` | Non-sensitive (recommended) | Back up the export file to Drive; Sidekick sees only files it created |

No **restricted** scopes (`gmail.readonly`, `gmail.modify`, full `drive`), so there is **no paid security assessment** (CASA). Sensitive-scope verification is free. Until it is approved, the consent screen shows "Google hasn't verified this app", and only test users (up to 100) can sign in. Keep the Google features off in the store build's listing claims until then, or accept the warning for test users.

## Consent screen (Google Cloud Console → Google Auth Platform)

- App name: Sidekick. Logo: the app icon (512 px). Support email: info@sashy.ai.
- App home page: https://robert-whiteley.github.io/sidekick-site. Privacy policy: https://robert-whiteley.github.io/sidekick-site/privacy (same as Play). Authorised domain: sashy.ai (verify it in Google Search Console first). The home page describes the app and links to the policy.
- Publishing status: In production (submit for verification).
- Android OAuth client: package `app.ondevice.sidekick` with the **Play App Signing** SHA-1 (Play Console → Test and release → App integrity), not only the upload key's SHA-1. Without it, sign-in fails in Play-installed builds. Add both fingerprints.

## Scope justifications (paste)

**gmail.send** — "Sidekick is an on-device assistant. When the user asks it to email someone ("email Jo that I'm running late"), it shows a draft in the chat. Only after the user reads it and taps Send (or says "send it" after hearing it read back) does it send that one email from the user's Gmail account. The app cannot read, list or delete mail, which is why we ask for gmail.send rather than a broader scope. The email goes straight from the phone to the Gmail API; we have no server and store nothing."

**tasks** — "Users can keep the to-dos Sidekick suggests (and they approve) in Google Tasks, and see tasks added elsewhere. Sidekick reads and writes the user's task lists for this two-way sync only when the user turns on the Google Tasks switch. Data goes directly between the phone and the Tasks API and is never sent to us."

**drive.file** — "Users can back up their Sidekick export file to their own Google Drive. drive.file lets the app see only the backup files it created, not the rest of the user's Drive."

Limited Use statement (in the privacy policy already): "Sidekick's use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."

## Demo video script (unlisted YouTube, ~2–3 min, English, a test Google account)

Show the real app on a phone, screen-recorded with the mic narrating. Use only test data (made-up contact "Jo Test").

1. **0:00** — Open Sidekick. Say: "Sidekick runs on the phone; Google features are optional."
2. **0:10** — Settings → Connections → turn on **Email (Gmail)**. Google's consent screen appears. **Show the address bar/app name and the OAuth client ID** (Google requires the consent screen with the app name, plus the client ID in the URL when shown in a browser; on Android, show the account chooser and the scope list "Send email on your behalf"). Approve.
3. **0:40** — In chat, say "Email Jo Test that the meeting moved to 3pm". The draft card appears; tap **Edit**, change a word, then **Send**. Open the test account's Gmail Sent folder in a browser and show the email arrived. Say: "Sidekick only sends emails the user approves; it can't read the inbox."
4. **1:20** — Settings → Connections → turn on **Google Tasks**; consent screen with "Create, edit, organise and delete all your tasks"; approve. In chat: "remind me to buy milk" → approve the to-do → open tasks.google.com and show it there. Tick it there, come back, and show it done in Sidekick.
5. **2:00** — Settings → Connections → Google Drive backup → **Back up to Google Drive**; consent "See, edit, create and delete only the specific Google Drive files you use with this app"; approve; run a backup; open drive.google.com and show the single backup file.
6. **2:30** — Turn the switches off; show myaccount.google.com/permissions where access can be removed.

Submit the video link, the justifications above and the privacy policy URL in the verification form. Google may email questions to the developer contact address; replies usually take a few days to weeks.

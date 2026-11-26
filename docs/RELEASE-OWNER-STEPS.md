# Owner steps: everything to click and paste, in order

The one file for launch. Claude keeps it up to date; everything else is done by Claude. Nothing
here costs money. Tick each one off.

- Play Console (Sidekick):
  https://play.google.com/console/u/0/developers/6582912466877904203/app/4974018181388560460/app-dashboard
- Website (live, GitHub Pages, no DNS needed): https://robert-whiteley.github.io/sidekick-site
- Files to upload (Windows **Downloads** folder, also in `fastlane/metadata/android/en-GB/images/`):
  `icon.png` (512 px), `featureGraphic.png` (1024 × 500), phone screenshots (Claude adds them).
- App bundle (`.aab`): https://expo.dev/accounts/rcwhiteley1/projects/sidekick/builds/fc974798-49dc-404b-a573-5df26a880ebe
  (open it → **Download** once it says Finished; built from main with the new icon)

## 1. Create the app

- [x] Create app: name `Sidekick`, package `app.ondevice.sidekick`, English (United Kingdom) – en-GB,
      App, Free, tick both declarations.

## 2. Finish setting up your app (Dashboard → "Finish setting up your app", top to bottom)

Each task in that list: click it → answer → **Save** → back to the Dashboard.

- [x] **Set privacy policy**: `https://robert-whiteley.github.io/sidekick-site/privacy`
- [x] **Sign in details**: **All functionality is available without any access restrictions**. If a
      note is asked for: `All features work without an account. Gmail send, Google Tasks and Drive backup are optional and use the reviewer's own Google account.`
- [x] **Ads**: No, my app does not contain ads.
- [x] **Content rating**: email `info@sashy.ai`, category **All other app types**, answer **No** to
      every question → Save → Submit. Expected: PEGI 3 / Everyone.
- [x] **Target audience**: **18 and over** only. "Could your app unintentionally appeal to children?": **No**.
- [x] **Data safety**:
  - "Does your app collect or share any of the required user data types?" → **No** → Next → Save.
  - If it asks: encrypted in transit **Yes**; deletion: users delete in the app (Settings → Privacy),
    and `https://robert-whiteley.github.io/sidekick-site/delete-data`.
- [x] **Government apps**: No.
- [x] **Financial features**: My app doesn't provide any financial features.
- [x] **Health**: tick **Activity and fitness** only (Sidekick can say today's step count; the data stays on the phone) → Next.
- [x] **Trader status**: **Yes, my trader status applies to this app** (your account is a trader;
      "No" would tell EU/UK users consumer protection doesn't apply, and would need changing for any
      paid feature). Terms of Service URL: leave empty (optional; Claude writes terms if paid features come).
- [x] **Target audience** extra box "Restrict users … determined to be minors": tick it.
- [x] **Select an app category and provide contact details**: category **Productivity**, tags skip;
      email `info@sashy.ai`; website `https://robert-whiteley.github.io/sidekick-site`; phone empty.
- [x] **Set up your store listing** (checked: screenshots in order 1–5, no video):
  - App name: `Sidekick: Private AI Assistant`
  - Short description: `An AI assistant that runs on your phone. Works offline. Your data stays yours.`
  - Full description: all of `fastlane/metadata/android/en-GB/full_description.txt`
    (https://github.com/robert-whiteley/sidekick/blob/main/fastlane/metadata/android/en-GB/full_description.txt
    → copy button at the top right).
  - App icon `icon.png`, feature graphic `featureGraphic.png`, phone screenshots `phone-1.png` …
    `phone-5.png` in that order. Video: leave empty.
  - AI asset declaration: **Label assets as created or edited using AI** → label only `icon.png` and
    `featureGraphic.png` (Claude made them); the screenshots are real app screens.

## 3. Foreground service permissions (appears under Policy → App content after the first upload)

One video covers all four uses: `sidekick-play-video.mp4` in your Windows **Downloads** folder
(1 min 43 s). Upload it once at https://studio.youtube.com → Create → Upload videos → visibility
**Unlisted** → copy the link. Then tick each type below, paste its text, and paste **the same link**
into all four video boxes:

- Microphone: `Sidekick is a voice assistant. When the user turns on Listening, it keeps hearing for its wake word and transcribes conversations on the device, including with the screen off or another app open. The user starts it from the app, a permanent notification with a Stop button is shown the whole time, and stopping it ends all microphone use. Audio is processed on the phone and never uploaded.`
- Camera: `With Live camera on, Sidekick keeps seeing through the phone or a connected USB camera so the user can later ask about what they saw ("what did that sign say?"). It runs with the screen off for hands-free use with a chest-mounted or USB camera. The user turns it on in the app; the notification shows that the camera is on and has a Stop button. Frames are processed and stored only on the phone.`
- Location: `While Listening or Live camera is running (started by the user in the app), Sidekick tags each saved moment with the town it was in, using a place list built into the app, so the user can ask "what did I see in Bristol?". Location is only read while that user-started service runs and never leaves the phone.`
- Short service: `Runs a routine the user created in the app (a scheduled recap, briefing or reminder check) at the time they chose, on the device, and stops when it finishes.`

Not needed now: SMS and Call Log declaration (release 2; see the end), background location (not used).

## 4. The new app bundle

- [x] Built from `main` with the new icon: the App bundle link at the top of this file. Upload that one in
      steps 5 and 6.

## 5. Internal testing (optional: puts the app on your own phone in minutes)

- [ ] Test and release → Testing → Internal testing → **Create new release** → upload the `.aab` →
      accept **Play App Signing** → Next → **Save and publish**.
- [ ] **Testers** tab → Create email list → add your Google account → Save → copy the **opt-in link**
      → open it on the phone → Accept → install from Play.
- Before installing from Play, uninstall Claude's test version (it's signed differently). That deletes
  Sidekick's memory on the phone (only the app's own data).

## 6. Closed test (required before going public)

Google's rule for new personal accounts: **12+ testers opted in for 14 days in a row**, then apply.

- [ ] Test and release → Testing → Closed testing → **Create track** (or use Alpha) → Create release →
      upload the `.aab` (or "Add from library") → release notes `First test release.` → Next → Save →
      **Send for review**.
- [x] Testers → **Google Groups** → `sidekick-testers@googlegroups.com` → Save. Testers join
      https://groups.google.com/g/sidekick-testers (posted on Reddit).
- [ ] Once the release is reviewed, copy the **opt-in link** from the Testers tab and post it with the
      group link. Testers join the group, open the opt-in link on their phone → Become a tester →
      install, and stay in the group for 14 days.
- [ ] After 14 days: Dashboard → **Apply for production** → paste the answers Claude drafts → Submit.
      Review takes a few days.

## 7. Let Claude do every later upload

- [x] Users and permissions → `eas-submit@…` → App permissions → add
      Sidekick → tick Releases, Store presence, App access → Apply.

## 8. Google sign-in in the Play app (after the first upload)

- [ ] Play Console → Test and release → **App integrity** → App signing → copy the **SHA-1** of the app signing key.
- [ ] Google Cloud Console (Sidekick project) → Google Auth Platform → Clients → **Create client** →
      Android → package `app.ondevice.sidekick` → paste the SHA-1 → Create. Keep the existing client.
      Without it, Gmail / Tasks / Drive sign-in fails in the Play-installed app.

## 9. Google sign-in approval (Gmail send, Tasks, Drive backup; only these features wait on it)

- [x] Search Console (https://search.google.com/search-console) → Add property → **URL prefix** →
      `https://robert-whiteley.github.io/sidekick-site/` → HTML file method → Verify. Done on the Play account
      (the same account as the Google Cloud project `sidekick-515813`).
- [x] Google Auth Platform → **Branding**: app name `Sidekick`, support email (your account's), developer contact `info@sashy.ai`, home page
      `https://robert-whiteley.github.io/sidekick-site`, privacy policy
      `https://robert-whiteley.github.io/sidekick-site/privacy`, authorised domain
      `robert-whiteley.github.io`, logo `sidekick-logo-120.png` (Downloads).
- [x] **Data access**: scopes `gmail.send`, `tasks`, `drive.file`.
- [ ] Record the demo video on the phone (script: `docs/store/oauth-verification.md`, about 3 minutes,
      test account and made-up contact only) → YouTube **Unlisted**.
- [ ] **Audience → Publish app**, then **Verification centre → Submit** with the justifications from
      `docs/store/oauth-verification.md` and the video link. Answer Google's emails.

Until Google approves, only listed test users can use the Google features; the rest of the app works for everyone.

## 10. Later

- [ ] At ~800 monthly users (Play Console → Statistics): tell Claude, to switch quick fixes off by
      default or self-host them (`docs/RELEASE.md` D). Free up to 1,000 monthly users.
- [ ] Each production release: say "go". Claude never publishes to production without it.
- [ ] Release 2, texts and call log: Claude removes READ_SMS, SEND_SMS and READ_CALL_LOG from
      `app.json` `blockedPermissions`; you submit the SMS and Call Log declaration with the answers and
      video in `docs/store/permissions-declaration.md`.

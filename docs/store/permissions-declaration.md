# Play permission declarations (owner: Play Console → App content)

Checked 25 Nov 2026 against Play Console Help. Sources are listed at the end.

## 1. SMS and Call Log: Permissions Declaration Form (needed before the release that has them)

The build asks for `READ_SMS`, `SEND_SMS` and `READ_CALL_LOG`. Google allows them for the
**Default Assistant handler**. Sidekick only asks for them while it is the phone's default
digital assistant, and it stops using them as soon as it isn't (every use checks the role).

**Timing:** review can take several weeks. While it runs, that release waits as "pending
publication". If launch can't wait, ship the first release without these three permissions (add
them to `blockedPermissions` in `app.json`; the features then fall back to notifications and
"open Messages ready to send") and submit them in the next release.

**Form answers:**

- Core functionality: **Default Assistant handler**.
- Permissions: READ_SMS, SEND_SMS, READ_CALL_LOG. Not requested: RECEIVE_SMS, WRITE_SMS,
  RECEIVE_MMS, WRITE_CALL_LOG, PROCESS_OUTGOING_CALLS.
- Describe the feature (paste):
  > Sidekick is an on-device voice assistant that users can set as their default digital
  > assistant (Settings → Apps → Default apps → Digital assistant app). As the default assistant
  > it answers spoken and typed requests about the user's texts and calls ("read my last text
  > from Mum", "any new texts?", "who called me?", "any missed calls?", "call them back") and
  > sends texts the user dictated and approved ("text Sam I'm running late": the text is read
  > back and shown as a card with Send / Edit / Cancel). Sidekick asks for these permissions only
  > after the user has made it the default assistant, and stops using them when it is no longer
  > the default. Texts and call history are read on the phone only when the user asks (or a
  > routine the user created asks), are not stored by Sidekick, and are never sent to any server;
  > Sidekick has no servers.
- Instructions for the reviewer (paste):
  > No account or sign-in is needed. 1) Install and open Sidekick; wait for the model download
  > (about 3 GB, Wi-Fi). 2) Settings → Phone features → Digital assistant → choose Sidekick. 3) In Sidekick type "any new texts?" and allow the SMS permission when asked. 4) Type "who
  > called me?" and allow the Call log permission. 5) Type "text <a test number> hello", check
  > the card, tap Send. 6) Choose another digital assistant; ask again: Sidekick no longer reads
  > texts and explains how to turn it back on.
- Video: required (YouTube unlisted preferred, or a cloud MP4 link). Script below.

**Demo video script (under 2 minutes, screen recording on a test phone with test texts):**

1. Open Sidekick on the chat. Type "any new texts?". Show the card "make Sidekick your
   phone's digital assistant", tap **Open settings**, pick Sidekick, go back.
2. Ask "any new texts?" again. Android's SMS permission prompt appears; tap Allow. The answer
   lists the test text.
3. Say or type "read my last text from Mum": the answer is read out.
4. "Who called me?": the Call log prompt, Allow, then the list of calls. "Call them back": a
   Call card appears; tap Cancel.
5. "Text Mum I'm on my way": the read-back and card appear; tap Send. Show the sent text in
   Google Messages.
6. Settings → Digital assistant → choose another app. Back in Sidekick, "any new texts?" now
   answers from notifications only and says how to turn it on again.

**Data safety:** the texts and call history never leave the phone, so they are not "collected"
under Play's definition. No change to the Data safety form is needed; the privacy policy says how
they are used.

## 2. Other declarations

| What                                                                            | Worth applying?                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreground service types (microphone, camera, location, shortService, dataSync) | **Required** (App content → Foreground service permissions) | Each type the build declares needs a description and a short video: microphone = wake word and listening the user started; camera = the live camera memory the user switched on; location = where you were, while that service runs; shortService = running a routine the user created; dataSync = turning a recording the user shared into text on the phone (text in RELEASE-OWNER-STEPS.md §3). |
| Photos and videos (`READ_MEDIA_IMAGES/VIDEO`)                                   | **No** (likely rejected)                                    | Only for apps whose core is broad photo access (galleries, editors) and where the system photo picker isn't enough. Phone search on Android reads only photo folders the user picks with the system folder picker; the permissions stay blocked in `app.json`.                                                                                                                                     |
| Exact alarms (`USE_EXACT_ALARM`)                                                | **No**                                                      | Only for alarm-clock and calendar apps; Sidekick keeps `SCHEDULE_EXACT_ALARM`, which the user allows once ("Alarms & reminders") from Sidekick's settings link.                                                                                                                                                                                                                                    |
| Full-screen intent                                                              | **No**                                                      | Default only for calling and alarm apps. Reminders use normal notifications.                                                                                                                                                                                                                                                                                                                       |
| Background location                                                             | **Not now**                                                 | One feature per declaration, a ≤30 s video and a prominent in-app notice. "Remind me when I get home" is a convenience that reviewers weigh against "can it work without background location". It can: place routines run while Listen is on. Revisit if users ask for place routines with the app fully closed.                                                                                   |
| Health apps (steps via `ACTIVITY_RECOGNITION`)                                  | **Maybe required**                                          | Listed under Play's health apps policy: fill in the Health apps declaration (App content) saying steps are counted on the phone and never shared.                                                                                                                                                                                                                                                  |

Sources: [SMS or Call Log permission groups](https://support.google.com/googleplay/android-developer/answer/10208820),
[Permissions Declaration Form](https://support.google.com/googleplay/android-developer/answer/9214102),
[Photo and Video Permissions](https://support.google.com/googleplay/android-developer/answer/14115180),
[Foreground service and full-screen intent requirements](https://support.google.com/googleplay/android-developer/answer/13392821),
[Background location](https://support.google.com/googleplay/android-developer/answer/9799150),
[Exact alarms: Android 14 changes](https://developer.android.com/about/versions/14/changes/schedule-exact-alarms).

## Health apps declaration: ACTIVITY_RECOGNITION (as submitted)

Feature: **Activity and fitness**. Description:

> Sidekick is an on-device AI assistant. When the user asks "how many steps have I taken today?", it answers from the phone's built-in step counter, which needs the activity recognition permission. Sidekick asks for the permission only the first time the user asks about steps, after an in-app notice explaining why, and the user can turn steps off in Settings. While the app is open it reads the step counter every 15 minutes to work out today's total. Only the step count is used; no other activity, health or location data is read. Step counts are stored only on the phone and are never uploaded, shared or used for ads.

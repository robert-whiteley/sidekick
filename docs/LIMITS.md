# Limits (measured)

What each feature does, where it stops, and what was measured on the **Pixel 5** (Snapdragon
765G, 8 GB RAM of which Android reports 7.3 GB, CPU only, Android 14) with the USB Arducam
plugged in. Builds sk44–sk45 (25 Nov 2026). "Other phones" says what is expected to differ.
Bugs found are listed per feature: fixed (with the fix) or left (with why; also in ADR 0006).

## Test phone state

- Storage: 13 GB free of 109 GB (89% used). Sidekick's models and data: 3.2 GB.
- RAM: Sidekick uses about 1.1 GB (PSS) with the chat model loaded; Android shows < 100 MB free
  at times (the rest is cache it can reclaim).

## Listening (background mic)

Works:

- Separate sentences with gaps of 3–4 s are each saved as their own line with audio.
- An 18 s monologue is transcribed in one piece, word-perfect.
- Speaking 9 s after turning Listen on is caught.
- Live camera on at the same time doesn't change accuracy.
- Listen stays on after the app is killed or force-stopped and reopened (fixed in sk44).

Bugs:

- **Fixed: first word clipped.** The speech detector starts a line ~0.1–0.3 s after the voice
  does, so "The parcel for flat three…" was saved as "Parcel for flat 3…". Each line now keeps up
  to 0.4 s of audio before the detected start (never reaching into the previous line).
  Verified on the phone: "The parcel for flat 3 is at the front desk."
- **Fixed: Listen didn't come back after the app was killed.** The choice is now remembered and
  listening restarts when the app is opened.

## Voices (who said it)

- Computer voices: Zira was named "Clara (auto)", Mark "Someone" (correct).
- David was labelled "You". Cause: the owner voice on the test phone had been learned from David
  during earlier push-to-talk tests (test sound through push-to-talk teaches the owner voice).
  Not loose matching. Left: a real owner talking to their phone doesn't hit this; see ADR 0006.

## Memory: facts about you

- **Fixed: template suggestions** ("My name is [Name].", "My birthday is [Date].") were left from
  before the fact reader rejected them. They are now removed when the app opens, and never saved.
- Odd phrasings like "My need for spare keys." come from other voices that were labelled as the
  owner (see Voices). Suggestions only; the owner approves or dismisses each.

## Chat model and memory search model together

- Owner decision (25 Nov): both may stay loaded on phones with ≥ 6 GB RAM while Android isn't
  short of memory; otherwise one unloads first and live-camera frames wait. The Pixel 5 keeps
  both. 4 GB phones (iPhone 13 mini class) never hold both.

## Speed (Pixel 5, CPU only)

| Step                     | Time                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| Load chat model          | 4.6–6.3 s                                                              |
| First word, new question | 1.3–1.4 s (0.15 s if the start is cached)                              |
| 3-sentence answer        | 11–12.5 s (about 5–6 words/s)                                          |
| Question about a photo   | 14–15 s, first word ~2.9 s                                             |
| Photo at half detail     | 11 s, but small text is cut short ("PLATFORM 4") — kept at full detail |
| Speech to text           | 7.4 s of speech in 1.4 s                                               |
| Voice check (who spoke)  | 0.45 s                                                                 |
| Load memory search model | 1.6 s, then 0.23 s per item                                            |

- First question after installing an update: ~60 s (model cold, plus notes for old chats being
  written in the background). After that a typical answer shows first words in ~2 s, done ~14 s.
- AI action router (decides timer / memory search / navigate before answering): 5.4–5.8 s for the
  routing step alone, then the action. Maps directions open ~2 s after that.
- "Your day" recap: 18.7 s. A routine answers ~15 s after it fires.
- Faster guessing ("speculative decoding") fails with photos on this model; left out (ADR 0006).

## Battery and heat

- Measured off the charger, screen on.
- Speed tests back to back: ~7% per 5 min (about 85–95% an hour).
- Live camera + Listen, idle chat: ~36% an hour.
- 94% → 25% in ~80 min of mixed heavy testing.
- Live camera running on the wireless charging pad still drained the battery (23 → 21%): the
  pad can't keep up with camera + model work on this phone.
- Phone stayed 27–33 °C; Android never reported heat throttling.
- Other phones: newer chips with GPU/NPU support use far less per answer.

## Storage

- App size: 4.2 GB (models 4.0 GB).
- Live camera + Listen add ~330 MB an hour before clean-up.
- Video keeps 2 hours by default on this phone.
- **Fixed: Storage screen disagreed with Advanced.** It said "Recommended (1 days)" and 12 GB
  while Advanced said 2 hours and 11 GB; both now read one source of truth.
- **Fixed: "11 (Recommended)" had no unit** when the recommended reserve isn't in the list;
  it now reads "11 GB (Recommended)".

## Chat

- Stop works mid-answer.
  - **Fixed:** tapping Stop just as the answer ended hit the mic button underneath and started
    listening; the mic now ignores taps for 0.8 s after an answer ends.
- Sending again while it is answering: the new text stays in the box (joined to the old text with
  no space). Not queued; left (ADR 0006).
- App in the background mid-answer: the answer finishes. App killed mid-answer: the question is
  lost; the app and Listen recover. Left (ADR 0006).
- Long input (~900 characters) works.
- Rotation: not applicable (portrait only).
- **Fixed: refused to write stories** ("I do not have a story about a dragon"). The instructions
  now let it write longer things when asked. Checked on the phone: it writes the story.
- "Search the web in your browser" shows under every offline answer, even trivial ones. Taste;
  left (ADR 0006).
- Statements are treated as questions: "My secret locker code is 4417." got "I do not have access
  to your secret locker code…". Small model; left.

## Off the record

- Long-press Send. A banner shows "this chat won't be saved · Leave". After Leave, the off-record
  question and answer are gone from the chat.

## Timeline

- **Fixed:** camera moments showed as blank rows with "Someone". They now show "Camera" and a
  thumbnail.

## Conversation notes

- **Fixed:** after an update the app posted a "Notes from your chat with…" notice for every old
  conversation at once. Notices now only go out for conversations from the last 30 minutes.

## Entry points

- "Digital assistant app settings" button opens Android's assistant settings (checked; the
  owner's default assistant was not changed).
- Quick Settings tile and home-screen widget: the "add" prompts appear. Not added on the test phone.

## Phone actions

- **Fixed: "set a timer" said there was no timer app.** Android's Clock refuses alarm and timer
  requests from apps that don't declare the "set alarms" permission (install-time, no prompt).
  Declared; a test checks the manifest. Only checked that the request is built; no real alarm set.

## Routines and the locked phone

- Routines fired on time even with Android's exact-alarm permission off.
- With the phone locked a routine now gives its real answer in a notification whose text is hidden
  on the lock screen (was "Unlock your phone first").
- "Keep filming when locked" off: locking pauses the camera (USB too) and the notification says
  "Sidekick camera is off while the phone is locked". Notification Pause camera / Resume camera
  work.
- Force stop (Settings → Force stop) leaves no "tap to turn it back on" notice: Android blocks all
  restarts after a force stop. The notice is for when Android itself stops the app; that can't be
  triggered without a rooted phone, so not tested.
- Voice "pause" while locked: camera pauses ~3.7 s after the wake word; "resume" ~11 s. "Resume
  the camera" is sometimes missed (ADR 0006).

## USB camera (Arducam 12MP, UVC)

- Listen switches to the USB camera's own mic when it is plugged in ("Mic disconnected: using the
  phone mic" when it goes).
- **Fixed: black picture with no warning.** One of the two Arducams (the wide-angle one) stopped
  sending frames: it opens and accepts settings but no picture ever arrives, and it shows nothing
  on a Windows PC either; the second Arducam works on the same cable and port. Builds before this
  investigation wrote no camera settings at all, so it is a fault in that camera (hardware or
  firmware), not Sidekick. The app used to keep showing the last frame, so it looked like a black
  or frozen view. Now: no frame within 8 s → it tries smaller or uncompressed modes, then switches
  to the phone camera and says "The USB camera sends no picture (check its plug)". Checked on the
  phone.
- **Fixed: a camera swapped in after a dead one was ignored** until the app restarted.
- Privacy shutter: only ever switched off, written straight to the camera, never "reset" (a camera's
  default can be on); a test guards this. This Arducam advertises a privacy control but refuses all
  privacy requests.
- Each time it opens, the camera is now set to automatic exposure, focus and white balance, and its
  picture settings are reset to the camera's defaults (takes ~3 s on this camera).
- After the app gives up on a silent USB camera it isn't retried until it is unplugged and plugged
  back in (ADR 0006).
- After an app update Live camera is off until turned on again (the update stops it).
- Both Arducams (0c45:636d, "Arducam_12MP") offer MJPEG only: 1280x720 to 2304x1296 at 30 fps,
  4608x2592 at 10 fps. Sidekick uses 1280x720; there is no smaller or uncompressed mode to fall back
  to on this model. Each open now logs the camera's ids, firmware and stream mode for support.

## Look (shared UI)

- Dark mode checked on the phone: speech-speed slider, choice sheet, Memory tabs. **Fixed:** the
  status bar showed dark icons on the dark background outside the chat.

## Not tested on the phone (and why)

- Reading incoming notifications: needs notification access, which would expose the owner's real
  messages.
- Unplugging the USB camera mid-use: needs someone at the phone.
- Sending, calls, real calendar/alarms/contacts: never done on the owner's phone; only the
  "Ask me first" draft card is checked.

## Round 5 phone checks (25 Nov, installed build sk56)

Stopped early: the phone fell from 33% to 10% battery in about 13 minutes (Live camera, Listen,
background photo work, phone at 38.8 °C, Android thermal status "severe") and Android offered
Extreme Battery Saver. Not run for that reason: place naming (fake GPS), locked "resume the camera"
repeats, the full camera speed run.

- **Offline queue, partly:** with airplane mode on, "what's the weather in Banbury tomorrow" showed
  "Offline · no internet" but no "I'll get the forecast when you're back online" line; the answer
  was still "…" after 30 s, then "Thinking…" more than 3 minutes after the internet came back.
  Likely cause: the question waits for the embedder, which was busy with a run of background photo
  vectors taking 74–79 s each on the hot phone ("[embed] 2 items, 86336 ms" for the question's own
  text). Questions jump the model queue (llm-queue.ts) but not the embedder queue. To fix: questions
  that don't need memory (weather, timers) shouldn't wait for the embedder, and background photo
  vectors should stop for a question and when the phone is hot.
- **When hot:** the camera slowed to 1 frame a second, then 1 frame every 2 seconds with video
  recording paused, and said so in the chat.
- **Text reading (OCR):** 1.0–2.9 s per frame (about 1.0 s cool, 1.1–2.9 s hot).
- **Photo vectors:** 74–79 s per photo when hot (normally a few seconds).
- **Free space:** 12 GB of 109 GB. The bigger Gemma (E4B, about 3 GB) would fit, but would go
  below Sidekick's own reserve rule (keep 10% free, about 11 GB here). Don't download it on this
  phone.
- **Two mics at once:** the phone lists Bluetooth headset, wired headset and USB mics on one shared
  input (only one at a time), but USB mics also have their own separate "hifi" input. So a headset
  mic plus the USB camera's mic together looks possible but isn't proven; it needs a test with both
  plugged in.

## Round 5b (25 Nov, sk58, partial)

- Typed "switch to the front camera": worked in ~11 s (router 9.9 s), reply "Using the front camera.
  Switched from the USB camera to the phone camera." Settings → Phone camera then shows Front; the
  Camera input row still showed the USB camera (display may lag the switch; not confirmed).
- Typed "lower the frame rate": **failed**. The router picked camera_setting but the model filled the
  optional `fps` with a non-number, the whole call was rejected ("fps not a number") and the chat
  answered "I cannot lower the frame rate…". Cause: an invalid _optional_ number rejects the call,
  while an invalid optional choice is skipped (`tools-logic.ts` argument check).
- New Camera & audio rows (Phone camera Back/Front, Describe camera frames) render correctly in dark
  mode.
- Offline queue retest: started (airplane mode on for ~95 s, self-restoring, question asked from the
  phone), but Wireless debugging switches itself off when Wi-Fi drops, so the phone could not be
  reached afterwards and the result was not read. Offline tests need a USB cable for adb.

## Round 5c (25 Nov, sk59, Pixel 5 on a wireless charger)

- Installed sk59. Phone camera set back to Back; camera input was already the Arducam (Recommended).
- **Photo vectors run several times over.** With Listen on and the phone charging, logcat shows the
  same photo embedded 2–3 times (e.g. photo 805 three times, 809 three times): several idle-time
  embedding runs overlap and pick the same rows. Each photo takes ~6.5 s alone, but the logged time
  grows to 33–40 s because the runs queue on the embedder.
- **Question speed with that running:** "What can you do?" (quick command) ~instant; "Give me three
  tips for better sleep" 69 s to the first text (router step 57 s, waiting behind the photo runs);
  "How many days are in a leap year" a few seconds, once the backlog had cleared.
- **Wrong answer:** "A leap year has thirty-six days and an extra day" (model error).
- **Battery fell while charging:** 12% → 5% in about 15 minutes on the wireless charger (max
  charging current 110 mA, heat status moderate). Testing stopped there; offline queue, locked
  "resume", place naming, frame-rate commands, light mode and the store videos were not done.
- Store screenshots taken (demo-mode status bar, nothing personal): chat, Settings, Camera & audio,
  Privacy, Storage → `fastlane/metadata/android/en-GB/images/phoneScreenshots/phone-1…5.png`.
- Restored: Online lookup off, demo mode off, test files deleted. Listen left on (as found).

## Round 5d (26 Nov, sk60, Pixel 5 on USB at 450 mA)

- **Play foreground-service video recorded** (one file, 1 min 43 s, kept out of the repo in the
  owner's Downloads as `sidekick-play-video.mp4`). It shows: Listen on → "Sidekick is listening"
  notification with Stop (microphone); Live camera on → "Sidekick is watching and listening" with
  Pause camera / Stop camera / Stop, service type camera + location + microphone (0xC8), the phone
  locked and unlocked with the camera still running (camera); Privacy → Location "Remember where I
  was" on while the service runs (location); a routine created by typing, firing from the home screen
  with "Running a routine" (short service); Stop from the notification ends everything. Demo-mode
  status bar; an earlier town name in the chat and the lock-screen carrier name were covered.
- **"in one minute, tell me a fun fact" goes to the message tool**, not a reminder: it asked for
  contacts permission (denied, 106 s to the reply), then drafted "Message to me" (cancelled, never
  sent). One-off "in N minutes" reminders aren't understood; only repeating routines work
  ("every day at 23:59 tell me a fun fact" worked).
- **Routine confirmation wording:** "OK. Every day at 23:59, I'll: tell me a fun fact." (should read
  "I'll tell you a fun fact").
- **Routine timing:** the 23:59 routine ran at 00:00:05, about 1 minute late (exact alarms not
  allowed on this phone; Routines settings already says so).
- **Listen button goes stale after Stop in the notification.** The microphone and service stop, but
  the chat screen's Listen button and "Listening for 'Hey Sidekick'" line still show on, even after
  leaving and reopening the app; one tap then does nothing visible (it "turns off" what is already
  off). Cause: `AskScreen` sets its `listening` state only at start-up, on a tap and on a voice
  command; nothing re-reads `isListening()` when the native service is stopped from the notification
  or when the app returns to the front.
- **Privacy → "Look things up online"**: the description text shows a strikethrough line across
  "search Wikipedia" (rendering glitch, seen on the video frames).
- Not done (battery reached 15%): question speed with Live + Listen and the single-run embedding
  check, offline queue, typed frame-rate and lens commands, place naming with a test GPS provider,
  locked "resume the camera".
- Restored: Live camera off, Listen on (as found), Show conversation on, Online lookup off, demo mode
  off, contacts permission back to "ask", test routine and video files deleted from the phone.
  Do Not Disturb left on. A routine "tell me a fun fact about otters" (daily 17:27, from an earlier
  test) is still on the phone.

## Round 6 (26 Nov, sk61, Pixel 5)

Pixel 5 on USB (450 mA) then an AC charger, battery 31–39%, up to 34 °C, thermal status 0.

- **Offline with only Sidekick blocked** (Android still says online, badge stays "Online"): weather
  ("Paris tomorrow") said "I couldn't get the forecast just now. Try again in a minute." and wasn't
  queued; news and "who is the prime minister of Japan" found 0 sources and the model answered "I do
  not have access to real-time …" in about 7 s, not queued either. "Synonym for happy" answered
  "Joyful" in about 23 s (router picked memory search, 17 s). Network back: weather answered at once.
  Cause: only Android's own offline flag counted as offline. **Fixed** (sk62): a forecast or search
  where every request failed now counts as offline, so the question is queued ("I'll look that up
  online as soon as you're back online") and the queue keeps it until a retry actually reaches the
  internet. Retries happen on a network change or app start, so with only Sidekick blocked the answer
  waits for one of those.
- **Question speed** (Pixel 5, CPU): Listen and Live camera off: 23 s (router 15 s), 14 s for a
  Wikipedia question. Live camera on, Listen off: 22 s (router 11 s), 22 s. Live camera and Listen on:
  55 s (router 42 s), 25 s. Frame embedding pauses while a question runs (no frames stored in the
  73 s of a question) and embedding runs one at a time. The router often picks memory search for
  general questions, which costs 10–20 s. The logged first-token time repeats the same value across
  questions (stale metric, minor).
- **Typed camera settings**: "more frames" → 1 per second (11 s), "set the frame rate to 2" → 2 per
  second (11 s), "switch to the front camera" (18 s) and back (9 s), "lower the frame rate" 2 → 1 →
  0.5 all worked. At the minimum (0.5) "lower the frame rate" failed twice: it went to the model,
  which said "I cannot lower the frame rate…" with a Wikipedia source. Cause: the router's call came
  with no usable arguments and the question words weren't used. **Fixed**: the question's own words
  fill in (number, more/less, front/back/flip); at the minimum it says "Already at the fewest
  frames, 1 frame every 2 seconds."
- **Frame captions on the charger**: captions ran (7 frames captioned). With the battery falling 37 →
  31% on 450 mA USB they kept running. Cause: the drain check compared only the first and last
  reading in the window, and the level bounces by 1%. **Fixed**: it compares the latest reading with
  the highest one.
- **One-off routine**: "in 2 minutes, tell me a fun fact" made a routine at once: "OK. Today at 14:26,
  I'll tell you a fun fact." (the round 5d wording is fixed). It fired on time and spoke a fact
  27 s later. The spent one-off stays in the Routines list ("last ran") until deleted (minor).
  Deleted after the test.
- **Place names**: "where am I" gave the right street and town. Camera frames had no place in the
  Timeline. Cause: frames were stored without the last known location. **Fixed**: frames get the
  place known within the last 10 minutes.
- **Light mode**: chat, Settings, Camera & audio, Privacy and Routines all readable. Night mode
  restored.
- **Locked "resume the camera"**: unlocked, typed pause/resume worked and the notification showed
  "Sidekick camera is paused" with Resume camera / Stop. Locked, two failures:
  1. The Sidekick notification didn't show on the lock screen at all. Cause: its channel was "low"
     importance, which the Pixel hides on the lock screen, and a channel's importance can't be
     changed once created. **Fixed**: a new "Listening and camera" channel at default importance
     with no sound or vibration, public on the lock screen; the old channel is removed.
  2. Spoken "Hey Sidekick, resume the camera" was heard but answered "Unlock your phone first, then
     ask me again." Cause: the locked-phone guard ran before the camera commands. **Fixed**: camera
     commands, speech speed and "stop listening" now run while locked; everything else still asks
     to unlock.
- Junk suggested facts from commands, such as "My preference is to resume the camera.", show in
  Memory → You (left alone).
- The "tell me a fun fact about otters" routine (daily 17:27) is still on the phone.
- **Re-checked on sk62** (same phone, AC charger, 39–65%): with only Sidekick blocked, "weather in
  Madrid tomorrow" was queued ("There's no internet right now. I'll get the forecast as soon as
  you're back online."); "who is the prime minister of Japan" gave the model's own answer plus "I'll
  look that up online as soon as you're back online." After unblocking and an app restart both
  answers arrived as "You asked at …" cards (the Japan one used Wikipedia, 1 source, but the model
  still named a former prime minister). A forecast asked earlier was answered from the cache while
  blocked. "lower the frame rate" at 0.5 → "Already at the fewest frames, 1 frame every 2 seconds."
  (9 s). Camera frames now show the town in the Timeline. Locked: the "Sidekick is listening (camera
  paused)" notification shows on the lock screen with Resume camera / Stop camera / Stop; Resume
  camera from the lock screen resumed it ("Sidekick is watching and listening") without unlocking;
  Stop ended everything. The spoken "Hey Sidekick, resume the camera" from the laptop speaker wasn't
  picked up twice on sk62 (microphone recording, not silenced), so the locked voice path is
  covered by tests only this round.
- Restored: Sidekick network unblocked, Live camera off, Listen off (service stopped from the
  notification; as found), lens Back and 0.5 frames per second (Recommended), Online lookup on,
  night mode on, screen-stay-on back to off. Phone left locked for the owner to unlock.

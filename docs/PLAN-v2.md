# Plan v2: real-time wearable assistant

Owner decisions from 25 Nov 2026 (this file is the single source of truth for the next phase;
tick items off here, move finished decisions into ADRs). Status (audit 25 Nov): built items are
ticked, with what was phone-tested; unticked ones are in ROADMAP.md (Release 1 or Future).

## Principles (owner)

- Works instantly on first install for a lay person: zero required taps, no setup.
- Simple and intuitive, no bloat, no annoying messages.
- Every setting has a **Recommended** value worked out for this phone; users can change it.
- All processing and data on the phone; nothing to third parties (optional web lookup only).
- Settings list every feature on every device; unavailable ones say why ("needs a USB camera —
  not possible on iPhone") so users know it's the device.

## Decisions 25 Nov 2026 (round 2)

UI (ChatGPT-simple):

- No app name, no "Ready · CPU", no "Speak" toggle. Top: a menu (Memory) and a gear (Settings).
- Composer: field "Ask Sidekick"; mic button when empty, send arrow when there is text
  (WhatsApp/ChatGPT pattern; own Material Symbols icons, no copied branding). A camera button
  in the composer turns the camera on; the camera view shows only while the camera is in use.
- Long-press a message: copy / share. Answers are spoken when the question was spoken (voice
  in, voice out) and when headphones are on; a mute button on a playing answer.
- Settings rebuilt in sections: Assistant (voice, model, chat), Camera & audio (inputs and
  outputs, frame rate, frame window, video keep), Connections (each integration with its own
  switches, e.g. "Send emails from Sidekick"), Privacy (recording consent, pause places,
  online lookup, export, delete all), Phone features (every feature, with "not possible on
  this phone: why"), Advanced. Memory is its own screen: You (facts), People, To-dos,
  Timeline/history, Saved, Storage.
- Every setting that can help when changed is adjustable, with a Recommended value for this
  phone; Advanced holds the rest (frame window size, fps, image detail, model).
- "Off the record" mode (not "private": the whole app is private): stays on until left; a
  line at the top "Off the record: this chat won't be saved". Uses all memories, saves nothing.
  Dark display.

Media in chat:

- Show the actual stored moment, not a made clip: an inline player opened at that moment,
  scrub, tap ±5 s, free scroll outside the moment with a "Back to moment" button; Share and
  Save. Save offers a folder intelligently ("Pictures/Sidekick/Cars"), one tap to accept.
- Photos the same (swipe to neighbouring frames).
- Recall results: sort Best match / Newest / Oldest; only confident matches shown; Gemma
  checks the top matches by looking at them before answering. Text-to-image search works
  directly (the query is compared with the image, not with a caption).

Smart defaults pattern (everywhere): Automatic (Recommended) / Ask me / Off. Used for: model
updates (download better model on Wi-Fi + charging, switch after it works, delete the old one),
downloads on mobile data, storage cleanup, voice choice, frame rate.

Models: Recommended model per phone by default; Advanced lists alternatives (faster / smarter)
with size and speed; new models update automatically unless "Ask before updating" is on.

Uninstall: models (app-specific external files) and all data (app internal storage) are
deleted by Android on uninstall; only files the user saved/exported to shared folders stay.
Settings → Privacy → Delete all data does the same from inside the app.
Checked 25 Nov 2026: every file is app-private (filesDir/data, databases, shared prefs,
Android/data/<app>/files/models), allowBackup is off; Delete all data uses the system's
clearApplicationUserData (identical to uninstall). A new Recommended model arrives with an app
update (the catalog ships in the app; nothing is looked up online).

Distribution: one app, the Google Play build, the same for every user (owner decision 25 Nov:
keep it simple; the direct-APK "full" variant was removed, see ADR 0006). No Accessibility
control and no direct SMS: messages are sent through notification replies, else the app opens
prefilled and the user taps Send there.

Integrations now (each with its own switches in Connections):

- Calendar (read, create, edit), alarms and timers, Sidekick reminders, contacts, phone calls,
  maps/navigation hand-off, media control (play/pause/next, what's playing), photos/files
  (already), notifications read (Android).
- Messages (WhatsApp, Messages, Telegram, Signal…): read incoming via notification access;
  reply in the chat, sent through the notification's reply action; new conversations: draft
  in chat → opens the app prefilled (the user taps Send there).
- Email: Google sign-in (gmail.send) so Sidekick sends directly; draft card first (Send / Edit
  / Cancel / Open in Gmail). Reading mail uses notifications (Gmail's read scopes need a paid
  yearly security assessment). Needs the owner's Google Cloud OAuth client (free) — owner step.
- Offline: actions needing the internet wait in an outbox shown in the chat and go when online.
- Automations and voice: every action is available by voice and in typed chat.

Dev tooling (owner): no rules for AI to read. Checkable rules are silent scripts (commit hook,
CI, `scripts/claude-guard.py` session hook; list in CONTRIBUTING.md); the rest are notes in the
product docs (this file, SPEC, ARCHITECTURE, ADRs). Auto-memory off; no CLAUDE.md/AGENTS.md (the
hook and CI block them); the only other hook fast-forwards `main` at session start.

Owner steps needed later (not blocking the build):

- Google Play developer account — owner already has one (other apps).
- Google Cloud OAuth client for Gmail sending — owner's Google account, once, as publisher (free).
  Users only see Google's normal sign-in popup when they turn Email on. Public release needs
  Google's free OAuth app verification for the gmail.send scope (privacy policy + demo video).
- No sign-in or setup on first open. The intro page says the app and AI run on the phone, not
  in the cloud, and that it can connect to phone apps (calendar, contacts, messages…) and a few
  optional online services (web lookup, Gmail, model downloads); each permission is asked the
  first time that feature is used, not in one batch.
- Plug in the USB camera for the device tests.
- [x] Chat model + memory search model (embedder) loaded together: allowed when the phone has
      ≥ 6 GB RAM and Android isn't short of memory; on smaller or memory-short phones one unloads
      first (replaces "never together on the Pixel 5", which would reload the chat model after
      every memory question).

## Round 4 (25 Nov, owner feedback; built, phone test in progress)

- [x] Live conversation notes: start at once (no minimum length), update every few lines; actions
      changed / done in place. No fixed note templates (owner: no hardcoded templates).
- [x] "Your day" and the daily briefing removed as fixed features; recaps of any time or topic on
      request (rules parser + model fallback for unusual phrases); routines replace scheduled ones.
- [x] Routines (background agents): scheduled and triggered (message from X, before meetings, car,
      headphones, charging, unlock, place enter/leave while running, online / Wi-Fi).
- [x] AI router: rules first (instant), else Gemma picks from a tool catalog (≤3 steps), same draft
      cards. Navigation goes straight to Google Maps turn-by-turn (no chooser). Feedback by voice.
- [x] Location (opt-in, on the phone): positions while running, named places, parking, "where was
      I", weather (MET Norway, online lookup on), offline village names (≥500 people), naming
      frequent places by a chat card. No background location (see ADR 0006).
- [x] Offline queue: lookups / weather asked offline answered when back online; WorkManager wakes
      the app when the internet returns.
- [x] Camera (phone + USB), mic and spoken answers keep running with the screen locked.
- [x] Phone extras: battery, storage, steps, screen time, clipboard, find my phone, birthdays,
      share into Sidekick, rides / app search links, QR codes, "tell me when you see X", voice
      commands (speed, repeat, what can you do, stop listening, pause camera), app shortcuts.
- [x] Texts and call history when Sidekick is the default assistant (Play declaration needed).
- [x] English only for now; optional "Understand other languages around me" (Parakeet v3, 25
      languages, translated to English on the phone). Full localisation: ADR 0006 "Later".
- [x] Updates: Play builds plus Expo quick fixes (Settings → Advanced, on; Wi-Fi only) while under
      1,000 monthly users; then builds only or a self-hosted server (docs/RELEASE.md).
- [x] Open source: Apache-2.0; website on GitHub Pages (robert-whiteley.github.io/sidekick-site); support info@sashy.ai.
- [ ] Phone verification of all of the above (tester, sk46) → docs/LIMITS.md. Partly done: sk44–sk45 results in docs/LIMITS.md; the rest → ROADMAP Release 1.
- Owner steps: the complete list is docs/RELEASE-OWNER-STEPS.md (single source).
- Research and future: docs/research/*.md, docs/FUTURE-wearables.md, ADR 0006.

## Chat

- [x] One continuous conversation, no "New chat" button (owner: confirmed). Recent turns verbatim; older turns
      compacted into a running summary when: size limit, 10 min idle, or a natural end
      ("I'm going out", "that's all", "bye"). Every turn also saved in memory (searchable). Built + unit-tested; compaction not phone-tested.
- [x] Off the record mode (see decisions above). Phone-checked (LIMITS.md).
- [x] Chat shows images / video clips of what was seen when useful (as in livestream-ai). Built; see Chat media below.
- [x] Scrollable chat history, copy and share an answer. Long-press copy / share.
- [x] Drafts (email, message, event) appear in the chat as cards: Send / Edit / Cancel /
      Open in app. Phone-checked only up to the "Ask me first" card (nothing sent on the owner's phone).

## System notices (decided design)

- Passive changes are a **faint, small line in the chat** (not a message), tappable to open the
  matching setting with an override. Always say what changed and why, e.g.
  "Frame rate 2 → 1 fps: phone is hot (44 °C)". Shown only when something changes, merged if
  repeated (no spam).
- Things that need a decision are a **normal chat card with buttons** (e.g. "Storage will run
  out in ~2 days. Keep 2 days of video instead of 3? [Yes] [Settings]"). Only when action is
  really needed; never repeated within a day unless it gets worse.
- Types: frame rate / camera paused (heat, battery, low memory), storage close to limit,
  model unloaded for memory, mic/camera disconnected (USB unplugged), offline/online change
  only if a lookup was asked for.

## Voice

- [x] One voice per phone, chosen once at first run (Pocket if its first sound is ≤ ~1 s on
      this phone, else the system voice); never switches mid-use. Changeable in Settings. On the Pixel 5 Pocket was too slow, so the system voice is used (ADR 0006).

## Live camera + recall

- [x] Continuous frames from the phone camera or a USB camera; EmbeddingGemma 2 (440M,
      already used for photos) embeds frames directly (no text step). Target 2 fps; rate set
      per phone and lowered for heat/battery (with a notice). Near-identical frames skipped. Rate per phone (Pixel 5: 1 fps; 2 fps on fast chips). Frames per second not measured on the phone.
- [x] OCR on frames with text (signs, number plates); full-resolution still saved when text
      or a plate is seen. Not phone-tested on real signs/plates.
- [x] Recall: search finds the moment, then Gemma sees the actual frames (and, for movement,
      ~3 frames ~1 s apart around it) and answers ("how many trees did I see", "what did that
      sign say", "that car's number plate"). Answer shows the frame or plays the clip. Built + unit-tested, not phone-tested.
- [x] Live questions get the last ~3 frames (change over time: moving car, walking). Built, not phone-tested.
- [x] Video: 720p at 10 fps, rolling (Recommended: last 1–3 days by free space); stills,
      vectors and text kept for years. User can set e.g. 2 hours … 1 month. Pixel 5 keeps 2 hours by default (LIMITS.md); 2 h … 1 month.
- [x] Audio of conversations saved (speech only, Opus ~16 kbps ≈ 7 MB per hour of speech) so
      conversations can be listened back from search results; same consent rules as
      transcripts. Owner to confirm (see questions). Each saved line keeps its audio (phone-checked, LIMITS.md).

## Storage

- [x] Storage screen: usage per kind (video, stills, audio, text, models) and keep periods. Phone-checked (LIMITS.md).
- [x] Forecast from this user's actual use (MB per day) with a safety margin; warn only when
      a limit will be exceeded. Until there is enough data: "Forecast available after 1 day of
      use". Built + unit-tested, not phone-tested.
- [x] Always leave a reserve free for the phone (Recommended: max(2 GB, 10% of storage));
      when space is tight, the oldest video goes first, then stills older than the keep period;
      never text/vectors without asking. Built + unit-tested, not phone-tested.

## Recommended settings from the phone

- Read hardware (RAM, chip, free storage, thermal status) at install: instant.
- Speed (fps, voice choice, model backend) measured silently in the background right after the
  model download (~20–60 s, no screen, nothing to tap) and refined from real use. No visible
  test.

## First run (zero taps)

- [x] Model download starts by itself on Wi-Fi in the background (Android DownloadManager /
      foreground service: continues with the app closed; iOS background URLSession). On mobile
      data: card "Download 3.1 GB now on mobile data, or wait for Wi-Fi?" (default: wait). Android (DownloadManager); iPhone (expo-file-system background download task, 26 Nov, built and unit-tested, not run on an iPhone). Fresh-install run not phone-tested.
- [x] Storage check first; if not enough: card with the size needed and a link to the phone's
      storage settings. Built + unit-tested, not phone-tested.
- [x] While downloading: a static page explaining what Sidekick is and does, in plain words:
      your data stays on your phone, nothing is sent to anyone, works fully offline (also in
      airplane mode) except optional web search; what it's good at (remembers what you see and
      hear, reminders, drafts messages/emails, answers questions about what's in front of
      you) and its limits (a small model: not an expert on deep specifics). Time left shown. Built, not phone-tested.
- [x] When ready: an intro message in the chat ("Try: what am I looking at?" etc.). Built, not phone-tested.
- [x] Permissions asked in context (OS pop-ups when a feature is first used), all switchable
      in Settings.

## Phone integration (offline-first)

- [x] Calendar (read/write directly), reminders/alarms/timers, contacts, maps/navigation,
      music/media control, email (draft in chat → send through the mail app), messages
      (WhatsApp/SMS: draft in chat; reply via notification reply actions where available, else
      opens the app prefilled), notifications read (Android), share sheet in. No real send, call, event or alarm made on the owner's phone (privacy); only the draft card and the alarm request checked.
- [x] Offline sends: WhatsApp, Gmail and SMS queue their own sends offline, so Sidekick hands
      over at once; anything that needs Sidekick itself online is queued and shown as pending. Outbox built + unit-tested, not phone-tested.

## Inputs and outputs

- [x] Choose audio/video inputs and outputs; defaults pick the best connected hardware
      (USB camera > phone camera; headphones for output). Settings override. USB camera mic switch phone-checked (LIMITS.md).
- [x] USB UVC camera (Arducam IMX708 etc.) on any Android phone via USB host (UVCAndroid /
      libuvc; licence to verify). Not possible on iPhone (listed as such). Phone-checked with the Arducam (LIMITS.md); licence: ADR 0007.
- [ ] Split audio (headphone mic for commands, camera mic for conversation) if the phone
      allows two inputs at once; else camera mic for everything. To test. Only a probe of two inputs at once exists (not used, not tested); the headset mic is used during a button ask. → ROADMAP Future
- [x] Ask with the headphone / Bluetooth button. Built, not phone-tested.
- [x] Walk mode: camera + mic + headphones with the screen off. Walk mode = headset button used in the last 15 min; camera and mic with the screen locked phone-checked.

## Quality of life

- [x] Battery, heat and storage limits with notices (above). Heat throttling never triggered on the Pixel 5 (LIMITS.md).
- [x] One-tap Pause, clear recording indicator. Live badge (tap to stop), Listen switch, Pause camera in the notification (phone-checked).
- [x] Export and delete all data. Settings → Privacy; not phone-tested this round.
- [x] Read back before sending, like a car: "Text to Sam: … Send it?", then yes / no / "change
      it to …" / "add …" by voice (rules first, a short model pass if needed); the countdown starts
      after. Setting: When I speak (Recommended) / Always / Off. Built + unit-tested, not phone-tested.
- [x] Driving / walking mode: car Bluetooth (by name) or the headset button → spoken answers,
      read-back, bigger buttons. Automatic / Always on / Off. Built, not phone-tested.
- [x] Read new messages aloud (off by default; with headphones or the car, or always); "reply …"
      answers the one just read. Built, not phone-tested.
- [x] Scheduled send ("text Sam at 6pm …", "email Jo tomorrow morning …"): kept in the outbox, a
      notification at that time, card shows "Sends at 18:00". Built, not phone-tested.
- [x] Recurring reminders ("every Monday at 9", "every day", "every weekday"). Built, not
      phone-tested.
- [x] Quiet at night: no speaking out loud 22:00–07:00 or in Do Not Disturb, except into
      headphones / the car (on by default). Built, not phone-tested.
- [x] Daily briefing (off by default): notification at the chosen hour with today's calendar,
      due to-dos and follow-ups, read out on the next open. Built, not phone-tested.
- [x] "What did we talk about today / this week": that time's lines, summarised on the phone.
      Built, not phone-tested.
- [x] Haptic tick on send, cancel and listen start (expo-haptics, MIT; needs a new build).

## Assistant parity (25 Nov, round 3)

- [x] Live words while talking (push-to-talk, hands-free, after the wake word): Parakeet re-decodes
      the clip every 0.7 s on its own thread; shown on the status line. Speech starts at the first
      sentence (already). Status lines: searching memory / looking at N frames / reading the
      picture / looking it up online / reading N sources; a recalled clip shows before the answer.
      Built + unit-tested, not phone-tested.
- [x] Phone controls (Settings → Connections → Phone controls): open an app by name, torch, volume
      up/down/mute/%, Do Not Disturb (after allowing access), brightness (after "Modify system
      settings"), Wi-Fi / Bluetooth / mobile data / airplane mode open their switch (apps can't
      flip them), "play X on Spotify". Built + unit-tested, not phone-tested.
- [x] Sums, unit conversions and world time worked out in code. Translation by Gemma, including
      "translate this" on the camera or a screenshot (OCR first). "What's on my screen" points to
      the assistant gesture. Timers and alarms already go through planAction. Built + tested.
- [x] Phone locked (screen off, hands-free): only sums, conversions, the time, timers, alarms,
      torch and volume; anything else says "Unlock your phone first". Built, not phone-tested.
- [x] App lock in Settings → Privacy (expo-local-authentication, MIT): fingerprint, face or PIN on
      open and after 1 min away (Every time / 1 / 5 / 15). Built, not phone-tested.
- [x] Conversation notes (Settings → Assistant, Automatic Recommended / Off): after a Listen
      conversation ends (5 min silence or Listen off, ≥ 2 min and 6 lines, someone else in it),
      a background pass (only when the model is already loaded) writes who/topics/decisions/
      action items as a 'conversation_note' moment; action items go to follow-up approval; a faint
      "Notes from your chat with Sam" line opens the note page; Timeline links to it. Nothing off
      the record; only kept (consented) lines are read. Built + unit-tested, not phone-tested.
- [x] "Your day" recap (Off Recommended / 18:00–22:00): one evening line in the chat with the
      day's notes, places, things seen, to-dos done and due; tap opens the recap page. Shown
      while Sidekick runs (no system notification). Built + unit-tested, not phone-tested.
- [x] Google Drive backup runs: weekly on Wi-Fi + charging while the switch is on, plus "Back up
      now" in Settings → Privacy; keeps the last two (alternating files); notice on success or
      failure. Restore is manual (ADR 0006). Built + unit-tested, not phone-tested.

## From livestream-ai (the old cloud prototype; reviewed 25 Nov 2026)

- [x] Chat media: image thumbnails (tap → full screen, pinch-zoom) and clip tiles (poster
      frame, play with seek bar); "No clip: found the moment but its video isn't kept" when
      past the video keep period. Built, not phone-tested end to end.
- [x] Focus items: "tell me when you see a parking space / my bus"; spoken alert at a gap in
      conversation, deduplicated (old app: 8 s), never running narration. Built + unit-tested (8 s dedup), not phone-tested.
- [x] Recall as a tool loop (old: up to 5 hops): search memory, browse by time, frames around
      a moment (picked up / put down), look closer (high-detail re-read for labels/plates),
      answer with refs + optional clip (seconds before/after). Fixed step plans per question type (≤ 5 hops), not a free model loop. Not phone-tested.
- [x] Ranking: relevance gate, then recency for "where / last seen", else diversity (MMR)
      (old ADR 0003, the suncream case). Built + unit-tested.
- [x] Change settings by asking (typed or spoken) (frame rate, speech speed 50–200%, camera flip/resolution),
      "repeat that", "what can you do?". Frame rate, front/back camera and image detail go through
      the tool router (`camera_setting`, any phrasing; not offered to routines); front/back is also
      in Settings → Camera & audio. Built and unit-tested; not yet checked on the phone.
- [x] Idle-time captions: while charging/idle, Gemma writes a rich description per keyframe
      (objects, counts, text, motion) for counting questions; embeddings + OCR are the live
      path. Built + unit-tested, not phone-tested: on the charger only, 2 min after the app was last opened or asked, ≤ 60 frames per charge, stops at moderate heat; loads the model only on ≥ 6 GB phones not short of memory (else only when already loaded); Settings → Camera & audio → "Describe camera frames (Off, While charging, On battery too)" (on).
- [x] Lessons: no growing context for frames (old: $1.17 vs $0.40 per walk; repeats "oak
      tree"); use a 2–3 frame window only. Cutting clips from a still-recording MP4 was
      unreliable → record in short segments (old: 3 s) / ring buffer. 2–3 frame window and short video segments built.
- [x] UVCAndroid (com.herohan:UVCAndroid, based on saki4510t UVCCamera / libuvc): licence not
      stated in the old repo → verify before use. Checked: Apache-2.0 (ADR 0007).
- Old app had no USB-mic routing (default VOICE_RECOGNITION source only): new work.

## Measurements to run (on the Pixel 5 now, the new phone later)

- [ ] Model comparison: Gemma 4 E2B vs E4B, int4 vs int8, CPU/GPU/NPU, image token budget,
      frames per question, context length → time to first word, tok/s, RAM, battery, heat,
      quality on a fixed graded set of photo + recall questions. Partly: CPU/GPU, threads and image tokens measured (ADR 0006); E4B, int8 and a graded set not. → ROADMAP Future
- [ ] EmbeddingGemma 2 frames per second; OCR per frame; video encoder load. Not measured yet. → ROADMAP Future

## Future notes (not this version)

- Recommend a better device for missing features / speed. → ROADMAP Future
- [x] iPhone version (no longer deferred, 26 Nov): built for the App Store from the same code; what
      iOS can't do is hidden or explained (ADR 0006 "iPhone"). Left: first EAS iOS build (compile
      check of the Swift), TestFlight run on the iPhone 13 mini, App Store Connect forms and
      screenshots (owner, `docs/RELEASE-OWNER-STEPS.md` section 10). → ROADMAP Future
- [x] iPhone wording (26 Nov, from the first TestFlight screenshots): no Android words on iPhone
      (Face ID / passcode, Save to Photos, App Store, location while open); consent, Instructions
      only and pause places hidden; "what am I looking at?" opens the camera; the iPhone prompt
      says what the app can do. One place for these texts (`src/engine/platform-text.ts`) and a
      test (`__tests__/ios-wording-test.tsx`). Built and tested in jest; not yet run on the iPhone.

## Storage estimates (to measure)

- Text of everything heard + its vectors (256-dim): ~1–4 MB per day → ~0.4–1.5 GB per year.
  Kept indefinitely.
- Speech audio (Opus ~16 kbps, speech only): ~7 MB per hour of speech; ~3 h/day ≈ 20 MB/day
  ≈ 8 GB/year. Recommended keep: by free space (e.g. 3 months), user-settable.
- Video 720p 10 fps ≈ 0.5 GB per hour.

## Open questions (owner)

None open (answered 25 Nov: one Google Play app; email via Google sign-in).

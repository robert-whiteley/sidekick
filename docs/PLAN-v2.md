# Plan v2: real-time wearable assistant

Owner decisions from 25 Nov 2026 (this file is the single source of truth for the next phase;
tick items off here, move finished decisions into ADRs). Status: **awaiting answers to the open
questions at the end; nothing below is built yet unless marked.**

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

Distribution: both, one codebase, two flavours.

- Play (default for everyone): no Accessibility control; messages sent through notification
  replies, else the app opens prefilled.
- Direct APK ("full"): Accessibility can complete actions in other apps (tap Send) and direct
  SMS. Not against Google's terms; Android 13+ makes the user allow "restricted settings"
  for Accessibility, and Google's developer verification for sideloaded apps needs the owner's
  verified developer identity.

Integrations now (each with its own switches in Connections):

- Calendar (read, create, edit), alarms and timers, Sidekick reminders, contacts, phone calls,
  maps/navigation hand-off, media control (play/pause/next, what's playing), photos/files
  (already), notifications read (Android).
- Messages (WhatsApp, Messages, Telegram, Signal…): read incoming via notification access;
  reply in the chat, sent through the notification's reply action; new conversations: draft
  in chat → opens the app prefilled (full APK: sent automatically).
- Email: Google sign-in (gmail.send) so Sidekick sends directly; draft card first (Send / Edit
  / Cancel / Open in Gmail). Reading mail uses notifications (Gmail's read scopes need a paid
  yearly security assessment). Needs the owner's Google Cloud OAuth client (free) — owner step.
- Offline: actions needing the internet wait in an outbox shown in the chat and go when online.
- Automations and voice: every action is available by voice and in typed chat.

Dev tooling (owner): auto-memory off for this repo; facts live in repo docs (this file,
AGENTS.md, ADRs). Minimal hooks only (see AGENTS.md).

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

## Chat

- [ ] One continuous conversation, no "New chat" button (owner: confirmed). Recent turns verbatim; older turns
      compacted into a running summary when: size limit, 10 min idle, or a natural end
      ("I'm going out", "that's all", "bye"). Every turn also saved in memory (searchable).
- [ ] Off the record mode (see decisions above).
- [ ] Chat shows images / video clips of what was seen when useful (as in livestream-ai).
- [ ] Scrollable chat history, copy and share an answer.
- [ ] Drafts (email, message, event) appear in the chat as cards: Send / Edit / Cancel /
      Open in app.

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

- [ ] One voice per phone, chosen once at first run (Pocket if its first sound is ≤ ~1 s on
      this phone, else the system voice); never switches mid-use. Changeable in Settings.

## Live camera + recall

- [ ] Continuous frames from the phone camera or a USB camera; EmbeddingGemma 2 (440M,
      already used for photos) embeds frames directly (no text step). Target 2 fps; rate set
      per phone and lowered for heat/battery (with a notice). Near-identical frames skipped.
- [ ] OCR on frames with text (signs, number plates); full-resolution still saved when text
      or a plate is seen.
- [ ] Recall: search finds the moment, then Gemma sees the actual frames (and, for movement,
      ~3 frames ~1 s apart around it) and answers ("how many trees did I see", "what did that
      sign say", "that car's number plate"). Answer shows the frame or plays the clip.
- [ ] Live questions get the last ~3 frames (change over time: moving car, walking).
- [ ] Video: 720p at 10 fps, rolling (Recommended: last 1–3 days by free space); stills,
      vectors and text kept for years. User can set e.g. 2 hours … 1 month.
- [ ] Audio of conversations saved (speech only, Opus ~16 kbps ≈ 7 MB per hour of speech) so
      conversations can be listened back from search results; same consent rules as
      transcripts. Owner to confirm (see questions).

## Storage

- [ ] Storage screen: usage per kind (video, stills, audio, text, models) and keep periods.
- [ ] Forecast from this user's actual use (MB per day) with a safety margin; warn only when
      a limit will be exceeded. Until there is enough data: "Forecast available after 1 day of
      use".
- [ ] Always leave a reserve free for the phone (Recommended: max(2 GB, 10% of storage));
      when space is tight, the oldest video goes first, then stills older than the keep period;
      never text/vectors without asking.

## Recommended settings from the phone

- Read hardware (RAM, chip, free storage, thermal status) at install: instant.
- Speed (fps, voice choice, model backend) measured silently in the background right after the
  model download (~20–60 s, no screen, nothing to tap) and refined from real use. No visible
  test.

## First run (zero taps)

- [ ] Model download starts by itself on Wi-Fi in the background (Android DownloadManager /
      foreground service: continues with the app closed; iOS background URLSession). On mobile
      data: card "Download 3.1 GB now on mobile data, or wait for Wi-Fi?" (default: wait).
- [ ] Storage check first; if not enough: card with the size needed and a link to the phone's
      storage settings.
- [ ] While downloading: a static page explaining what Sidekick is and does, in plain words:
      your data stays on your phone, nothing is sent to anyone, works fully offline (also in
      airplane mode) except optional web search; what it's good at (remembers what you see and
      hear, reminders, drafts messages/emails, answers questions about what's in front of
      you) and its limits (a small model: not an expert on deep specifics). Time left shown.
- [ ] When ready: an intro message in the chat ("Try: what am I looking at?" etc.).
- [ ] Permissions asked in context (OS pop-ups when a feature is first used), all switchable
      in Settings.

## Phone integration (offline-first)

- [ ] Calendar (read/write directly), reminders/alarms/timers, contacts, maps/navigation,
      music/media control, email (draft in chat → send through the mail app), messages
      (WhatsApp/SMS: draft in chat; reply via notification reply actions where available, else
      opens the app prefilled), notifications read (Android), share sheet in.
- [ ] Offline sends: WhatsApp, Gmail and SMS queue their own sends offline, so Sidekick hands
      over at once; anything that needs Sidekick itself online is queued and shown as pending.

## Inputs and outputs

- [ ] Choose audio/video inputs and outputs; defaults pick the best connected hardware
      (USB camera > phone camera; headphones for output). Settings override.
- [ ] USB UVC camera (Arducam IMX708 etc.) on any Android phone via USB host (UVCAndroid /
      libuvc; licence to verify). Not possible on iPhone (listed as such).
- [ ] Split audio (headphone mic for commands, camera mic for conversation) if the phone
      allows two inputs at once; else camera mic for everything. To test.
- [ ] Ask with the headphone / Bluetooth button.
- [ ] Walk mode: camera + mic + headphones with the screen off.

## Quality of life

- [ ] Battery, heat and storage limits with notices (above).
- [ ] One-tap Pause, clear recording indicator.
- [ ] Export and delete all data.

## From livestream-ai (the old cloud prototype; reviewed 25 Nov 2026)

- [ ] Chat media: image thumbnails (tap → full screen, pinch-zoom) and clip tiles (poster
      frame, play with seek bar); "No clip: found the moment but its video isn't kept" when
      past the video keep period.
- [ ] Focus items: "tell me when you see a parking space / my bus"; spoken alert at a gap in
      conversation, deduplicated (old app: 8 s), never running narration.
- [ ] Recall as a tool loop (old: up to 5 hops): search memory, browse by time, frames around
      a moment (picked up / put down), look closer (high-detail re-read for labels/plates),
      answer with refs + optional clip (seconds before/after).
- [ ] Ranking: relevance gate, then recency for "where / last seen", else diversity (MMR)
      (old ADR 0003, the suncream case).
- [ ] Voice control of settings (frame rate, speech speed 50–200%, camera flip/resolution),
      "repeat that", "what can you do?".
- [ ] Idle-time captions: while charging/idle, Gemma writes a rich description per keyframe
      (objects, counts, text, motion) for counting questions; embeddings + OCR are the live
      path.
- [ ] Lessons: no growing context for frames (old: $1.17 vs $0.40 per walk; repeats "oak
      tree"); use a 2–3 frame window only. Cutting clips from a still-recording MP4 was
      unreliable → record in short segments (old: 3 s) / ring buffer.
- [ ] UVCAndroid (com.herohan:UVCAndroid, based on saki4510t UVCCamera / libuvc): licence not
      stated in the old repo → verify before use.
- Old app had no USB-mic routing (default VOICE_RECOGNITION source only): new work.

## Measurements to run (on the Pixel 5 now, the new phone later)

- [ ] Model comparison: Gemma 4 E2B vs E4B, int4 vs int8, CPU/GPU/NPU, image token budget,
      frames per question, context length → time to first word, tok/s, RAM, battery, heat,
      quality on a fixed graded set of photo + recall questions.
- [ ] EmbeddingGemma 2 frames per second; OCR per frame; video encoder load.

## Future notes (not this version)

- Recommend a better device for missing features / speed.
- iOS versions of everything (iOS deferred).

## Storage estimates (to measure)

- Text of everything heard + its vectors (256-dim): ~1–4 MB per day → ~0.4–1.5 GB per year.
  Kept indefinitely.
- Speech audio (Opus ~16 kbps, speech only): ~7 MB per hour of speech; ~3 h/day ≈ 20 MB/day
  ≈ 8 GB/year. Recommended keep: by free space (e.g. 3 months), user-settable.
- Video 720p 10 fps ≈ 0.5 GB per hour.

## Open questions (owner)

None open (answered 25 Nov: both flavours; email via Google sign-in).

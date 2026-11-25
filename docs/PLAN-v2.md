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

## Chat

- [ ] One continuous conversation, no "New chat" button. Recent turns verbatim; older turns
      compacted into a running summary when: size limit, 10 min idle, or a natural end
      ("I'm going out", "that's all", "bye"). Every turn also saved in memory (searchable).
- [ ] **Private mode:** can use all memories but saves nothing from the chat. Visually distinct
      (dark display). Enter by long-pressing the Ask button (one-off question) or a toggle
      (stays on until turned off). Owner to confirm the gesture (see questions).
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

1. Distribution: Google Play, direct APK, or both? Play forbids using Accessibility to drive
   other apps; direct APK allows it (fuller "do it for me" control of any app).
2. Email: draft in chat → Send opens the mail app prefilled (one more tap there), or optional
   Google sign-in so Sidekick sends directly (uses Google's servers, an account link)?

# 6. Left out, tried and rejected, or later

Date: 2026-11-23

Read this before proposing any of these again. Each line says why.

## Tried and rejected (measured on the Pixel 5)

- **Speculative decoding (Gemma multi-token prediction):** no speed gain on text, and photo questions fail. Off.
- **More or fewer LLM CPU threads (2/4/6):** no change. Library default kept.
- **GPU / NPU for the LLM on the Pixel 5:** the CPU was fastest. The app still measures each backend once per phone and keeps the fastest.
- **Visual tokens 70:** 12.5 s vs 18 s at 140, but reads sign text less reliably. 140 is the default.
- **Full-size photos to the model:** the model got a black image. Photos are shrunk to 768 px (`ModelImage`).
- **Moonshine v2 / Parakeet 110M speech-to-text:** far worse word error than Parakeet 0.6B (see ADR 5).
- **Streaming (word-by-word) speech-to-text:** the candidates are either under NVIDIA's own licence (not commercial-safe) or clearly less accurate. Instead, Parakeet runs per speech segment at ~0.25x real time.
- **`-mobile` gigaspeech wake-word build:** crashes sherpa-onnx 2.0.2.
- **sherpa-onnx 2.0.3:** the JitPack build is broken. Stay on 2.0.2.
- **onnxruntime-android next to sherpa-onnx:** both ship `libonnxruntime.so` with different symbol versions, so one side breaks. OCR uses a small JNI bridge (`ort_shim.cpp`) over sherpa's copy.
- **Paid web search APIs (Brave, Bing, Google, SerpAPI):** cost money or need an account. See "Web lookup" below.

## Known gaps (shipped without)

- Fixed since: firebase-messaging is excluded from the APK by `plugins/without-firebase-messaging.js` (local notifications only; −132 KB; a 2-minute reminder still fired on the Pixel 5); OCR models unload after 60 s idle and before Gemma or the embedder loads.

- **Pocket TTS on the Pixel 5:** first sound 3.8–4.3 s per sentence while Gemma is still writing (laptop: 0.6 s; voice-sample length makes no difference). The app falls back to the system voice automatically when a short sentence takes over 2.5 s. Faster phones keep Pocket. Background model passes (names, follow-ups) now wait while Sidekick answers or speaks (`foreground-gate.ts`, max 3 min), so they no longer slow the first sound further.

- **iOS:** deferred. No OCR, assistant role, tile or widget there yet.

## Later (not built yet)

- Nothing listed right now.

## Smart Turn end of turn (built 2026-11-24, Android)

- Smart Turn v3.2 (pipecat-ai, BSD-2-Clause, 32 MB, optional Wi-Fi download) through the ORT bridge. Whisper log-mel features in Kotlin (`WhisperMel.kt`): within 1.6e-5 of transformers' extractor; Kotlin + JNI bridge + sherpa's ORT 1.28.2 gives the same probability as Python (max diff 2.5e-6, 59 clips).
- In a spoken question (after the wake word, or a reply), after 256 ms of quiet it asks once; p ≥ 0.9 ends the turn now (`vad.flush()`), else the 0.6 s VAD silence ends it as before.
- Laptop, 59 Pocket TTS clips (2 voices; finished questions, the same cut mid-sentence, and ones trailing off on "and / um / the"), Silero VAD timing: finished questions end 627 → 436 ms after the voice stops (65% early); 13% of unfinished ones are cut off early (23% at p ≥ 0.8). 63 ms per check (features + model, 2 threads). Not yet measured on a phone or with real voices.
- Rejected: the 8 MB int8 export (moves up to 0.44 on 1e-5 input noise; cut off 41% of unfinished clips at 0.8 vs 23%). v3.0 / v3.1 recognised far fewer finished questions.

## Owner-only barge-in (built 2026-11-24, Android)

- Once the owner's voice is known, talking over Sidekick stops it only if 1.5 s of the speech matches the owner's voiceprint (cosine ≥ 0.55, as in `voices.ts`); the voice stays turned down meanwhile. Shorter interruptions don't stop it; the wake word always does (unless Sidekick just said it). No owner voice yet: anyone can interrupt, as before.
- JS pushes the owner centroid on every change and at start (`listenSetOwnerVoice`); native keeps it in app-private SharedPreferences (not the encrypted DB) for the listen service.
- Bug found on the Pixel 5 and fixed: sherpa's one-shot `Vad.compute` was fed 512 samples, but Silero v5/v6 needs the previous 64 in front (576). The probability stayed ~0, so barge-in (also before this change) and Smart Turn never fired. `SileroWindow` adds the context. After the fix, on the phone: Smart Turn p = 0.93–0.98 on finished questions, 270–350 ms per check, and it ended turns early.
- Review fixes: the owner's voiceprint in preferences is now encrypted (AES-GCM, Android Keystore key; the old plain copy is deleted). A guest's short wake-word clip that fails the owner check is no longer saved as the owner's line. A stop sent before a background job reached the model was lost (the question waited seconds); the queue now re-sends it every 250 ms until the job ends. `LlmEngine.cancel()` no longer throws on a just-closed conversation, and the next generate is freed only after the callbacks finish.
- Verified on the Pixel 5 (laptop-speaker voices): the owner's voice talking over a long answer scored 0.68 and stopped it at once; another voice scored 0.21–0.23 and the answer carried on. A quick "stop" without the wake word no longer interrupts once the owner is known.

## Names and descriptions from context (built 2026-11-24)

- Before: a name came only from a self-introduction ("my name is Sam", applied) or a single "thanks, Sam" with one other voice nearby (suggested only).
- Rules: "Sam, can you…" / "hi Sam" / "…, Sam?" point at the voice that answers next (within 10 s); "thanks / bye / sorry, Sam" at the voice that just spoke. Falls back to the only other voice within 20 s.
- Live, on each new line: Gemma reads the conversation going on (≤30 lines, back to a 10-minute gap; "Me" / "Person N"), in the background (waits behind questions, stopped by them; only when the model is already loaded). It gives each unnamed person a first name if one is clear, and otherwise a description of what they seem to be from what is said ("would you like to order?" → waiter; bus driver, doctor, colleague; man/woman/child only if that is all that is clear).
- A description shows at once instead of "Person N" ("Waiter"; generic ones keep the number: "Man 3"); the latest reading wins; a name replaces it. Questions can use it ("what did the waiter say?", roles only, one match).
- Names need evidence: a rule cue counts 1, the model's reading 2 (once per voice per conversation); at 3 the name is applied as an auto name (undo on the person's page, never re-applied after "no"). Below 3: "Is this Sam?". A model name is kept only if it was actually said.
- Rejected: guessing man/woman (or age) from the voice itself: unreliable, and a sensitive inference from biometric data; only what is said is used. Applying the model's name guess alone (it can misread who answered). A pass only after the conversation ends (user wants it live).
- Verified on the Pixel 5 (a restaurant scene, two laptop voices, consent asked and given): the other voice showed as "Waiter" live, during the conversation. The first prompt called them "Customer"; telling the model to judge each person by what they themselves say, with a waiter/customer example, fixed it.
- Short lines (under 2.5 s) join a known other voice when it is clearly closest (≥0.45 and 0.1 above every other voice; never the owner, centroid not updated). Unmatched ones wait up to 60 s and are relabelled when their voice becomes known; only a line with no clear voice stays "Someone". Lines from 0.5 s get a voiceprint for this (barge-in still needs 1.5 s); under 1.5 s nothing is learned and the owner is never matched loosely. Verified on the Pixel 5: three ~1 s lines from a known voice (0.62–0.64) were labelled with it instead of "Someone". Suggested facts must start with "My" or a word the owner said (a model remark had become a suggested fact). Ask box: the keyboard no longer covers the Ask button (Android edge-to-edge needs `padding`). Each reading takes seconds of CPU on the Pixel 5 while speech-to-text and the voice also run (Pocket's first sound rose to 3–6 s during these tests).

## Spoken reminders (2026-11-24)

- "Remind me (to/about) … <time>" is parsed by rules (`parseReminderRequest`) and scheduled at once, with no model call. Before, Gemma replied "I have set a reminder" while nothing was scheduled (follow-ups only came from the background suggestion pass).
- No time said → an undated to-do, and the reply says so. "Remind me what / where / who …" is a question, answered normally.
- Rejected: letting Gemma decide via a tool call (slower on the Pixel 5 and can still claim success without acting).
- Verified on the Pixel 5: "Remind me to call the dentist tomorrow at nine" → alarm at 09:00 next day, reply at 0 ms. Without "Allow exact reminders" in Settings, Android may fire it up to 1 hour late.

## Smaller fixes from phone tests (2026-11-24)

- Questions to Sidekick are no longer read for follow-ups: they turned into to-dos ("Find capital of France") and re-suggested reminders already set. Only things said around you and photo notes are.
- A screenshot from the assist key is used only for questions within 2 minutes, then dropped.
- Turning the Folders source on now reads the picked folder at once (before: only "Add a folder" did).
- Verified on the Pixel 5: a text PDF and a scanned (image-only) PDF in a folder source were both found and answered from (6.7 s / 5.4 s). Default assistant (assist key) and the Quick Settings tile open Sidekick; the widget (placed later) opens Ask and Capture.

## Background model passes use a throwaway chat (2026-11-24)

- Fact, follow-up and photo-description passes now always run in a separate scratch conversation. Seen on the Pixel 5: a spoken follow-up continued the follow-up pass's chat and answered "1 | todo | Kick | -".

## PDFs in folder sources (built 2026-11-24, Android)

- Embedded text from Android's own PDF engine (pdfium): `PdfRenderer.Page.getTextContents()` on Android 15+, `PdfRendererPreV` on Android 11–14 with the S-extension 13 system update. Adds 0 bytes and no licence.
- Rejected: pdfbox-android (Apache-2.0, but several MB of APK and slower, heavier text extraction than pdfium); a hand-written extractor (fonts, CMaps and compressed object streams make it unreliable).
- Pages with under 20 letters/digits of embedded text, and every page on phones without the text API, are rendered at 1600 px and run through the photo OCR.
- First 30 pages, 50 MB max, up to 100 passages. One page per native call during the 15-minute folder scan; a scan starts no new PDF after 60 OCR'd pages.
- Gap: older phones without the S-extension update OCR every page (slower; no text from vector-only pages it can't read). Not yet measured on a phone.

## Web lookup

- No free, keyless, full-web search API exists. Scraping search engines breaks their terms.
- Built in instead: Wikipedia and DuckDuckGo instant answers. Both are free and need no account or key, and are off by default (the app has no network by default).
- Optional: the user's own SearXNG URL.
- Full results free: a "Search the web in your browser" link opens DuckDuckGo in the browser with search words (names stripped), sent only on tap. It reuses the lookup's words; if none ran, they are worked out on tap (Gemma ≤1.5 s, else rules), so nothing runs after every answer and TTS isn't slowed.
- News ("latest / news / today / what happened"): GDELT DOC 2.0 (free, any use, cite GDELT) and Wikipedia "Portal:Current events" for today + yesterday (one request, CC BY-SA), in parallel with the rest, same 4 s timeout. A news question with no topic skips Wikipedia/DuckDuckGo search. GDELT allows one request per 5 s; busy replies (429, plain text) just count as no results.
- Optional user-added RSS/Atom feeds (https only, max 10, read only for news questions, matched on the phone). Parsed by a ~100-line reader (titles, links, dates; no DTD or entity expansion, 1 MB cap). `xml2js`/`sax` are only build-tool dependencies and Node-oriented, so not used in the app.
- Gemma writes the search words (≤8, names stripped) in a throwaway chat (`scratch` option in the native module) that sees only the question and keeps the spoken conversation's history intact. Budget 1.5 s, then cancelled; rules otherwise. Skipped when the model is busy.
- Rejected: Brave (account + card, $5/1,000), Mojeek (paid), Marginalia (paid keys), public SearXNG servers (JSON off, block bots), Firecrawl/Parallel (vendor AI services).
- Rejected: publisher RSS bundled by default (terms vary; BBC's are personal, non-commercial only).
- Rejected: automating Google or the browser, by scraping or an AccessibilityService (against Google's terms and Play policy).
- Rejected: computing the link's words with Gemma after every answer (CPU contention with speech, wasted when not tapped).
- Wikipedia User-Agent has no contact details (would be personal info); may be rate-limited harder if Wikimedia tightens.
- The hidden "LOOKUP" turn is undone (the chat is cloned before it and restored) so follow-ups only see the real question and answer.
- Gap: Gemma's search words on a Pixel-5-class CPU may often miss the 1.5 s budget (then rules are used); a `[lookup]` log line now shows which was used and the timings.
- Measured on the Pixel 5 (Wi-Fi, UK): "who won the 2022 world cup?" answered from Wikipedia in 9.6 s (lookup ~2.5 s). GDELT took 9 s+ to answer at all (even its 429 "busy" reply), so with a 4 s limit news questions got no news source. A later test (24 Nov) waited 9 s and GDELT still only replied 429 after 10–11 s on every try (also from the laptop), so it is back to 4 s. Gap: GDELT is unreliable from here, so news on niche topics often falls back to Wikipedia facts or "no current information"; Wikipedia current events (0.3 s) and user-added RSS feeds work. No free, key-less, commercial-safe general news search was found to replace it (Nov 2026: Currents allows commercial use free but needs a key/registration; GNews and Mediastack free plans are non-commercial). Owner decision 24 Nov: leave news as is. Built-in RSS feeds rejected: most news feeds (BBC, Guardian, Reuters) are personal/non-commercial use only.
- Online lookup stays off by default (owner decision 24 Nov). The Ask screen's badge is the Online/Offline button: tap to switch; it shows "Offline" whenever there is no internet (airplane mode, no signal), and "Offline · no internet" if lookup is on but unreachable. Widget verified on the Pixel 5: Ask opens Sidekick listening, Capture takes a photo.

## Distribution: one Google Play app only (25 Nov)

- Removed: the direct-download APK ("full" flavour) with an Accessibility service that pressed Send in WhatsApp after approval, and direct SMS sending. Owner decision: keep it simple, every user gets the same app; two variants are too much to manage.
- Why they can't be in the Play app: Play's Accessibility API policy bars apps that aren't accessibility tools from using it to carry out actions (including autonomous AI actions), and Play allows SEND_SMS only for the default SMS/assistant handler.
- Result: new chats in WhatsApp, Messages, Telegram and Signal open with the text ready and the user taps Send there; replies to a message notification are sent directly by Sidekick through the notification's reply action.

## Hands-free and quality of life (25 Nov)

- Car detection uses the Bluetooth device's name (car makes, "car", "Uconnect", "SYNC"…), not the Bluetooth device class: reading the class needs the extra Nearby devices permission. Gap: a car kit with an unusual name isn't seen; "Driving and walking mode: Always on" covers it.
- Walk mode = the headset button was used in the last 15 minutes (there is no separate walk switch).
- Read-back covers messages, emails, calendar events and calls. Notes and to-dos aren't drafts: "remind me …" already says what it saved, so it isn't read back.
- Voice edits change the message / email text or the event title ("add …" on an event sets its place). Recipient, subject and time can't be changed by voice yet: tap Edit.
- After a read-back the mic opens for 6 s (no end-of-speech detection in push-to-talk). With Listen on, its follow-up window hears the answer instead.
- Scheduled send: emails and replies to a message notification go by themselves at the time if Sidekick is running. A new chat in WhatsApp / Messages / Telegram / Signal can only be opened with the text ready (no direct SMS or Accessibility in the Play app), and Android doesn't let an app open another from the background, so the notification at the send time asks to open Sidekick, which then sends or opens the chat. Scheduled calls and events: left out (events already have a time).
- Read incoming messages: only while Sidekick is running (checked every 5 s), and only messages Notification access can see. Not while an answer is being given.
- Quiet at night uses the same times as Auto-pause. Do Not Disturb is read with NotificationManager.getCurrentInterruptionFilter (no permission needed). iPhone: no DND or headphone check yet, so only quiet hours apply.
- Daily briefing reuses the follow-up digest switch and hour (one setting, not two). Calendar events only when calendar access was already given; it never asks. Spoken once a day, on the first open after its time.
- Recurring reminders: daily, weekdays or one weekday. "Every month", "every other week" and end dates are left out. Done moves the reminder to its next time; it never closes.
- "What did we talk about": summarises up to 120 lines spread over the time asked (today, yesterday, this week, last week, this morning, last hour), on the phone.

## Assistant parity (25 Nov)

- Live words are a re-decode of the growing clip (Parakeet is offline-only; no new model, no new
  licence). Every 0.7 s, one at a time, clips up to 30 s; longer push-to-talk shows no more live
  words until the end. A partial can delay the final text by up to one decode. Shown on the status
  line (last 14 words), not in the composer: editing AskScreen's composer was kept out.
- Wi-Fi, Bluetooth, mobile data and airplane mode can't be switched by a Play app since Android 10:
  Sidekick opens the system switch (Settings panel) instead.
- Do Not Disturb sets "priority only", not "alarms only" or "total silence".
- "Play X on Y" uses the standard play-from-search hand-off; apps that don't support it (YouTube)
  get their search screen. Whether the app plays at once is up to the app.
- Lock screen: Sidekick does not draw over the lock screen. Showing the chat there would show the
  chat history to anyone holding the phone; left out. When the phone is locked (a spoken question
  with the screen off), only sums, conversions, the time, timers, alarms, torch and volume run;
  everything else says to unlock first. Phones kept unlocked by Smart Lock count as unlocked.
- App lock covers the screen only. Background listening and spoken answers carry on while it is
  locked (the phone-lock rule above still applies with the screen off).
- Left out: changing the brightness without the "Modify system settings" permission (Android has
  no other way), relative volume steps for other streams (ring, alarm), opening apps by package
  name or deep links inside apps, and an offline translation model (Gemma translates; quality is
  lower for rare languages).
- Rejected: QUERY_ALL_PACKAGES (Play restricts it): the app list uses a launcher-intent query.
- Google Drive backup has no restore inside Sidekick: the backup is the same zip as Export
  everything (JSON + photos), kept for the user; importing it back (merging speakers, vectors and
  encrypted media) is not simple and is left out for now. Restore = download from Drive, manual.
- Conversation notes wait for the model to be loaded for another reason (like facts and
  follow-ups) instead of loading it just for a note: loading Gemma in the background competes
  with the embedder for memory on 4 GB phones. Conversations older than 2 days are not written up.
- "Your day" is an in-chat line only, not a system notification at the chosen time (would need a
  scheduled background task to build the recap while the app is closed).

## Location memory (25 Nov)

- Built: a location track (encrypted DB) while Listening / Live camera runs (native, journaled) or the app is open (every 5 min); places named by voice ("call this place the gym", "this is home"); where am I / where was I at 3 / where did I park / when was I last at X / how long at X / where have I been; enter/leave events for routines (`onPlaceChange`, `src/engine/location-track.ts`); weather from MET Norway (Online lookup only, position rounded to ~1 km). Settings → Privacy → Location (switch, places, delete history).
- No ACCESS_BACKGROUND_LOCATION: Play requires a declaration and review for it, and Android 14+ blocks while-in-use location in services started from the background. Positions are kept only while the user-started service runs or the app is open; when Android restarts the service on its own (in the background) it restarts without location (and stops instead of crashing if Android refuses the start).
- Parking: marked when a car kit's Bluetooth (by name, as hands-free mode) disconnects while Sidekick runs; otherwise guessed from the first slow fix after driving speed, which can be a few hundred metres off (updates are at most every 5 min / 100 m to save battery).
- Town names stay offline (GeoNames, towns ≥ 15 000 people). Rejected: bundling cities500 (~200 000 places, ~10 MB more) for village names. Street names come from Android's Geocoder (Google, online) only when Online lookup is on.
- Rejected: Open-Meteo (free tier is non-commercial only). MET Norway needs an identifying User-Agent: "Sidekick/1.0 https://sidekick.sashy.ai" (no personal details).
- Left out: named places in the Timeline (it shows the town); place-based reminders while the app is fully closed (needs background location); "frequent places" are only hinted ("you've been here on 5 days; name it"), never named automatically; Android 16 "home/work" from Google is not readable by apps.

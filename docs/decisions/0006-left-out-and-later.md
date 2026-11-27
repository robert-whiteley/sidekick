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

- **iOS:** built 26 Nov (section "iPhone (26 Nov)" below); not yet run on an iPhone.

## Later (not built yet)

- Nothing listed right now.

## Chat: Edit, Try again, answer style, formatting, private facts (26 Nov)

- Edit and Try again work on the last exchange only (the one continuous chat would otherwise
  disagree with what the model was told later). Not offered on photo or screenshot questions (the
  photo can't be taken again), rule replies (reminders, drafts, "remember …": redoing them would
  repeat the action) or Off the record (nothing was saved; its own chat isn't rewound).
- Taking an exchange back restarts the model's chat from the summary and the turns left (one
  re-read of the instructions, about a second on the Pixel 5) instead of undoing just the last
  native turn: an answer with an online lookup is two turns, so undo alone could leave half of it.
- Rejected: a markdown library (react-native-markdown-display and similar pull in a parser and
  styles for far more than we use); our own parser covers lists, steps, bold, small tables.
- A person fact the model can't clearly classify counts as private and is not suggested (better
  to lose a suggestion than to keep a private one). Facts the user asks Sidekick to remember are
  always kept. Conversation notes and voice descriptions are not filtered.

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
- The User-Agent names the app only ("SidekickApp/1.0 (on-device assistant app)"): no URL, email or username (owner, 26 Nov: nothing in the app names the developer; a test bans them in src/). Rejected: a project URL in the User-Agent, which would lift Wikimedia's limit from 10 to 200 requests a minute. Instead each phone stays under the unidentified limit: one per-minute window of 9 for all Wikimedia requests, research trims its searches (2 Wikimedia requests each) and reads fewer Wikipedia pages to fit, using the search snippet for the rest, and a 429 / Retry-After gets one wait-and-retry.
- The hidden "LOOKUP" turn is undone (the chat is cloned before it and restored) so follow-ups only see the real question and answer.
- Gap: Gemma's search words on a Pixel-5-class CPU may often miss the 1.5 s budget (then rules are used); a `[lookup]` log line now shows which was used and the timings.
- Measured on the Pixel 5 (Wi-Fi, UK): "who won the 2022 world cup?" answered from Wikipedia in 9.6 s (lookup ~2.5 s). GDELT took 9 s+ to answer at all (even its 429 "busy" reply), so with a 4 s limit news questions got no news source. A later test (24 Nov) waited 9 s and GDELT still only replied 429 after 10–11 s on every try (also from the laptop), so it is back to 4 s. Gap: GDELT is unreliable from here, so news on niche topics often falls back to Wikipedia facts or "no current information"; Wikipedia current events (0.3 s) and user-added RSS feeds work. No free, key-less, commercial-safe general news search was found to replace it (Nov 2026: Currents allows commercial use free but needs a key/registration; GNews and Mediastack free plans are non-commercial). Owner decision 24 Nov: leave news as is. Built-in RSS feeds rejected: most news feeds (BBC, Guardian, Reuters) are personal/non-commercial use only.
- Online lookup stays off by default (owner decision 24 Nov). The Ask screen's badge is the Online/Offline button: tap to switch; it shows "Offline" whenever there is no internet (airplane mode, no signal), and "Offline · no internet" if lookup is on but unreachable. Widget verified on the Pixel 5: Ask opens Sidekick listening, Capture takes a photo.

## Distribution: one Google Play app only (25 Nov)

- Removed: the direct-download APK ("full" flavour) with an Accessibility service that pressed Send in WhatsApp after approval, and direct SMS sending. Owner decision: keep it simple, every user gets the same app; two variants are too much to manage.
- Why they can't be in the Play app: Play's Accessibility API policy bars apps that aren't accessibility tools from using it to carry out actions (including autonomous AI actions), and Play allows SEND_SMS only for the default SMS/assistant handler.
- Result: new chats in WhatsApp, Messages, Telegram and Signal open with the text ready and the user taps Send there; replies to a message notification are sent directly by Sidekick through the notification's reply action.
- Update 25 Nov (texts and calls as the default assistant): Play's SMS/Call Log policy lists "Default Assistant handler" as a permitted use (READ_SMS, SEND_SMS, READ_CALL_LOG among others), so the one Play app now reads texts, sends approved texts directly and reads the call history, but only while Sidekick is the phone's default digital assistant: the role is checked before asking for a permission and natively before every use (Play: stop using them as soon as it isn't the default). Not the assistant: the fallback above, plus a one-time card with the Settings button. Needs the Permissions Declaration Form (docs/store/permissions-declaration.md; review up to several weeks).
- Left out of texts and calls: RECEIVE_SMS (new texts already arrive through Notification access; one permission fewer to justify), MMS pictures, WRITE_SMS and deleting texts, WRITE_CALL_LOG, saving texts or calls into Sidekick's memory (read on request only), and texts in WhatsApp/Telegram/Signal (no API; notifications only).

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
  name or deep links inside apps. (A separate offline translation model was left out here too;
  measured and still not used, see "Interpreter" below.)
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
- Place names offline: GeoNames cities500 (every town and village ≥ 500 people, 226 551 places) packed to 5.2 MB (2.7 MB in the download), replacing the 1.4 MB towns ≥ 15 000 table. On iPhone the same pack is bundled in the app (26 Nov). Street names come from Android's Geocoder (Google, online) only when Online lookup is on.
- Rejected: Open-Meteo (free tier is non-commercial only). MET Norway's terms: requests must name the application; a contact email or website is recommended, not required (checked 26 Nov 2026). The app sends its name only, "SidekickApp/1.0 (on-device assistant app)" (got a 200); the risk is that MET can't contact the app before throttling it.
- Left out: named places in the Timeline (it shows the town); Android 16 "home/work" from Google is not readable by apps. Frequent places are now offered for naming once, while the user is there ("You're often here (near Banbury, evenings). Name it?" Home / Work / Other… / Not now; never asked again for that spot).
- Place routines ("when I get home …") run only while Sidekick is open or listening (its foreground service reads the position). Left out with the app fully closed: it needs ACCESS_BACKGROUND_LOCATION, which Google Play allows only after a Permissions Declaration (core-feature justification, a prominent in-app disclosure, a demo video, review; often refused when the feature isn't the app's main purpose), and Android geofencing comes from Google Play services (closed source). Owner's call if wanted later.
- Network work with the app closed: Android's WorkManager wakes Sidekick when the internet or Wi-Fi comes back (plus a 15-minute check), so waiting questions, research, directions, emails, Tasks sync and backups, and "when I'm back online / on Wi-Fi / leave Wi-Fi" routines run then. Directions back online can't open Maps from the background (Android 10+ blocks background activity starts), so with Sidekick closed, or asked for over 15 minutes ago, they wait for a tap on a notification or card (kept 3 hours); a ride is never ordered later by itself (the ride app is opened now and deals with its own connection). iPhone: no background wake-up for this queue. BGTaskScheduler runs only when iOS chooses (often hours later, and a processing task needs the phone idle), and too briefly to load the 3 GB model; NWPathMonitor works only while the app runs. So on iPhone the queue runs while Sidekick is open: when the connection comes back (expo-network's listener) or the app comes to the front. "Go offline" / "leave Wi-Fi" with the app closed are noticed at the next 15-minute check at worst; Android may delay checks further in battery saver or Doze.

## Languages: English app, other languages heard (25 Nov)

- Owner decision: offer a language only when every feature works in it. Sidekick is English-only
  for now: screens, commands, spoken confirmations, the system prompt, the wake word ("Hey
  Sidekick") and the speech model (Parakeet v2) are English. The phone's voice is set to English
  so a phone set to German doesn't read English answers in a German voice.
- Built instead: **Understand other languages around me** (Settings → Assistant, off by default).
  Listen switches to Parakeet v3 (25 European languages, CC BY 4.0, 0.5 GB on Wi-Fi; v2 deleted).
  Lines heard in another language get an English translation from Gemma in the background
  (4 lines per pass, only when the model is loaded, stopped by questions), stored after the
  original ("→ English: …") so search, recall, notes, recaps and answers ("what did the waiter
  say?") use the English. Questions to Sidekick stay English.
- Parakeet reports no language, so the line's language is guessed from the script (Cyrillic,
  Greek) and common short words / letters; unsure or short lines are left untranslated.
- Removed: the earlier Language picker, the automatic switch to v3 on non-English phones, answers
  in the phone's language, and the "translate a command into English for the rules" pass (half
  the app stayed English: screens, confirmations, 13 of 24 languages without command words).

## Interpreter (owner, 26 Nov: "useful abroad with no internet")

- Decision changed: the app stays English, but Sidekick now interprets live between the owner
  (English) and someone speaking another language, fully offline. Earlier "English-only" covered
  the whole app; the owner overrode it for this feature because it is what a phone is for abroad.
- Translation: **Gemma 4 E2B**, the model already on the phone. Measured against the best
  commercial-safe dedicated model, Mozilla's Firefox Translations (Bergamot / Marian, MPL-2.0),
  on 20 made-up travel turns in 7 languages (docs/BENCH.md "Interpreter"): Gemma chrF 70.2 into
  the language / 75.9 into English vs 68.7 / 71.0; Bergamot reversed a medical line in Japanese
  ("if the fever doesn't go down in three days" → "if you don't have a fever"), Gemma made no
  meaning errors. Bergamot is ~10× faster but needs its own native engine on both phones
  (bergamot-translator C++ with ruy, not built for iOS yet) and two ~40 MB downloads per language.
  On the Pixel 5 a Gemma turn takes ~5.3 s, the first words showing after ~3.2 s; Bergamot stays
  the option if that feels slow.
- Rejected translation models: NLLB-200 and M2M-100 / SeamlessM4T (CC BY-NC, non-commercial),
  Opus-MT / Helsinki models (CC BY 4.0 weights but per-pair Marian builds and weaker than
  Bergamot), Google ML Kit translation (closed source, Google Play services), slimt (GPL-2.0),
  MADLAD-400 (too big for 4 GB phones).
- Speech: European languages with Parakeet v3 (already in the app), the others with Whisper
  small (MIT, 375 MB). Rejected: Moonshine non-English models (community licence with a revenue
  cap), SenseVoice (FunASR model licence, attribution and use terms; only 5 languages), Whisper
  base (twice the errors of small in every language measured), Whisper large / turbo (too big
  and slow for a Pixel 5 CPU).
- Japanese speech recognition is not verified: all three models (Whisper small / base,
  SenseVoice) failed on the bench's generated Japanese voice (63–112% characters wrong), which
  points at the made-up audio (Kokoro's Japanese voice) rather than the models; needs a real
  speaker. Arabic and the other non-European languages: translation measured, hearing not.
- The owner talking to Sidekick mid-conversation: decided by the model in the same reply as the
  translation (`SIDEKICK: NO / END / LANGUAGE: <language>` before `SAY:`), with no word list.
  Asked as "is the owner giving you, the interpreter, an instruction about the
  interpreting itself?", right on 57 of 60 lines (laptop): all 9 stops and all 6 language
  changes, none of the ordinary lines such as "please stop the car here"; the 3 misses were
  "Thank you very much, that's all for today", which ended the session. Asked as "who is this
  said to (OTHER / END / LANGUAGE)" inside the same reply, Gemma never switched language (0 of 6)
  and stopped on 0–9 of 9 depending on the wording.
  The earlier design (a second call, only for lines with a word like "stop") was a word list
  and missed "Can you use Italian with her instead?". The Done button always works.
- Goodbyes (27 Nov): the turn reply read wrap-ups to the other person ("we're finished here,
  thank you so much") as END under every wording tried, so an END gets a second look on its
  own ("who is this said to? OTHER / END / LANGUAGE"), which keeps goodbyes as OTHER. On 84
  lines incl. held-out ones: 57 of 57 ordinary lines translated, 15 of 15 stops, 9 of 12
  switches; the extra call only runs when the turn reply said END.
- Starting it: the translate tool with `talk: true`, not a tool of its own. As its own tool
  the sorter picked plain translate for 3 of 5 conversation requests under every wording tried;
  with `talk` worded as "help talking with a person in that language (interpreting between us,
  both ways, out loud); false for a text to translate", 8 of 8 conversation requests open the
  interpreter and no plain text does (27 Nov; was 4 of 5).
- Voices: the phone's own offline TTS (Android TextToSpeech / iOS AVSpeechSynthesizer), so no
  download from Sidekick. Missing voices are shown with a button to the phone's voice downloads
  (Android) or the Settings path (iPhone; apps can't install voices there).
- Left out: other languages for the owner (the owner's side is English, like the app), the
  interpreter in the background or with the screen off, saving the conversation (nothing is
  kept), languages neither model hears (Persian, Urdu, Swahili, …), choosing the voice.

## Later: full localisation

- Possible now: the 25 Parakeet v3 languages: English, Bulgarian, Croatian, Czech, Danish, Dutch,
  Estonian, Finnish, French, German, Greek, Hungarian, Italian, Latvian, Lithuanian, Maltese,
  Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Ukrainian.
- Each language needs: every screen string; the command rules (reminders, timers, time ranges,
  sums, phone controls, routines, read-back yes/no, consent phrases, name cues); spoken
  confirmations; the system prompt; a wake phrase (or keep "Hey Sidekick"); the phone's voice in
  that language (Pocket TTS is English only); the store listing and privacy policy; tests.
- Design so new features get every language automatically: all user-facing strings in one
  catalog (keys, English source); a test that fails if any key lacks a translation in any
  enabled language; translations generated at development time (not on the phone) and reviewed;
  command rules data-driven per language (word lists), with the model as fallback; a language is
  switched on only when its whole test set passes. Cost: every new feature adds strings and rules
  in 25 languages, which is why it waits.
- Speech model trade-off: v3 is worse in English (2.9% → 3.8% words wrong in quiet, 7.2% → 17.9%
  at 5 dB noise, laptop, 73 LibriSpeech clips), so English users keep v2. Auto-detecting the
  spoken language (one model for everyone) needs v3 or a language-ID model in front of v2.
- No commercial-safe on-device speech model checked for: Chinese, Japanese, Korean, Arabic, Hindi
  and other Indian languages, Turkish, Norwegian, Hebrew, Thai, Vietnamese, Indonesian. (The
  interpreter uses Whisper small (MIT) for these; see "Interpreter".)

## Break-it test leftovers (25 Nov, Pixel 5; details in docs/LIMITS.md)

- Test sound played into push-to-talk can teach the owner voice the wrong person; a real owner
  talking to their own phone doesn't hit this. Left.
- Killing the app mid-answer loses that question. Rare; left.
- A second send while answering isn't queued (text stays in the box). Left.
- "Search the web in your browser" no longer shows under every answer (owner, 26 Nov: "under every
  answer seems bad"). With online lookup on, Sidekick already decides by itself when to look
  things up (rules, then Gemma can ask for a lookup); the link shows only when a lookup found
  nothing. With it off, the link shows only for explicit searches and news / latest / current
  questions (`webLinkWanted`), never for jokes, recipes, explanations or the user's own life.
- Offline hand-offs (26 Nov, limits bench): blocking every browser and app hand-off while Offline
  was considered and rejected. It would overturn the link above and the offline WhatsApp/SMS
  hand-offs (ADR 0008), which the user asks for or taps explicitly, and where the other app, not
  Sidekick, does the network part. What changed instead: with Offline on, a web search (or a named
  app that isn't installed, which would fall back to the browser, including Uber's web page) is no
  longer opened by itself; the reply says so and shows the browser link, opened only on tap.
  Installed apps the user names (YouTube, Maps, Spotify, rides, messages) still open. The case
  that found it: a plain "give me a quick recipe for pancakes" was routed to app_search and opened
  Chrome while Offline; requests for words now get no tools at all.
- Reading incoming notifications and unplugging the USB camera mid-use were not tested on the
  owner's phone (privacy / needs a person there).
- After the app gives up on a silent USB camera it isn't retried until replugged (retrying a dead
  camera every few seconds would just flicker between cameras). Left.
- Statements are answered as questions ("My locker code is 4417" → "I don't have access…").
  Small-model limit; left.
- Voice "resume the camera" is sometimes not recognised while locked; saying it again works. Left.

## One look on Android and iOS (25 Nov)

- The UI is one shared component library (`src/ui`) with one token file, identical on both platforms (owner: same on iOS and Android); `__tests__/ui-conventions-test.ts` fails when a screen bypasses it without a `// ui-exception: <why>`.
- Icons: identical since 26 Nov. Android draws Material Symbols through expo-symbols; the iPhone draws the same glyphs from the bundled Material Symbols font (Apache-2.0, `@expo-google-fonts/material-symbols`), checked against expo-symbols' codepoints by `__tests__/icons-test.ts`.

## iPhone (26 Nov)

Built for the App Store from the same code (no Mac: EAS builds in the cloud). Swift in
`modules/sidekick-native/ios/`; every native call Swift doesn't implement has a safe iPhone answer in
`modules/sidekick-native/src/ios-fallbacks.ts` (a test fails if one is missing), so nothing crashes or
hangs. Not compiled locally (no Swift toolchain on Linux); the first EAS build is the compile check.

Works on iPhone: chat by typing or holding the mic (Apple Speech, on the device), the Gemma model and
memory search (LiteRT-LM Swift, CPU), photos and "what am I looking at?", text in photos (Apple
Vision instead of the PaddleOCR models), QR/barcodes, PDFs, memory and recall, reminders, calendar,
contacts, maps, battery/storage/steps (Core Motion through expo-sensors), place names (the same
GeoNames pack, location "while using" through expo-location), the model download (background
URLSession through expo-file-system), app lock, export and delete-everything, online lookup.

Left out on iPhone, with why (users see the reason in Phone features, Connections or the reply):

- **Background listening, wake word, live conversation notes:** iOS doesn't let an app keep the
  microphone on in the background for this. Hold the mic instead. Reply: "iPhone apps can't listen
  in the background. Hold the mic button to ask." Privacy hides Consent mode, Instructions only and
  pause places (push-to-talk takes only the owner's own question); Auto-pause becomes "Quiet hours"
  (the times "Quiet at night" uses).
- **Live camera memory and "tell me when you see…":** iOS doesn't let apps film in the background, and
  there is no USB camera API for apps. Reply: "iPhone apps can't film in the background, so there is
  no live camera. Tap the camera button to take a photo, then ask about it." "What am I looking at?"
  (or "what is this?", "watch live") with the camera closed opens the camera instead of asking the
  model; the next send takes the photo. The iPhone system prompt says the same, so the model doesn't
  guess (it once talked about "Android phones").
- **Routines:** an iPhone app can't wake itself at a time or on an event to run the model. Reply:
  "Routines aren't possible on iPhone…"; the Routines settings row is hidden. Reminders still arrive (local
  notifications).
- **Quick Settings tile, home-screen widget, default assistant:** Android features. Not listed in
  Phone features on iPhone (nor USB camera, heat protection or the two-mic split). The iPhone
  equivalent is built (owner asked, 26 Nov): three App Shortcuts, "Ask Sidekick" (Siri asks for the
  question), "Start voice question" and "What am I looking at?", in Siri, the Shortcuts app,
  Spotlight and the Action Button picker; Control Center through its "Shortcut" control (pick a
  Sidekick action). Swift in `app-intents/`, compiled into the app target by `expo-app-intents`
  (Expo, MIT, alpha; Apple reads App Shortcuts only from the app target, not from pods). Each opens
  the app and hands over the request (`src/engine/app-intents.ts`); the answer is worked out and
  spoken in the app. The question never travels in a link (any app can open one), and one left
  waiting over 2 minutes, or sent before the model is in, is dropped.
- **Answering inside Siri without opening the app:** rejected. The intent would have to load the
  3 GB model in the background, which iOS doesn't allow for long and the 4 GB iPhone 13 mini can't
  hold next to Siri; it also can't keep listening. Answers open in the app.
- **A Sidekick button of its own in Control Center (ControlWidget):** later, if asked for. Needs a
  separate WidgetKit extension target (its own bundle ID and signing profile, iOS 18+);
  `expo-widgets` doesn't make controls. The built-in Shortcut control runs the same actions today.
- **Study mode (quiz me / flashcards from notes):** dropped by the owner (26 Nov): features like
  this should come from the model itself, not be built specially. Asking "quiz me on my notes
  about X" gets the model's normal answer from memory.
- **Notifications, messages, calls, alarms, timers, media, phone controls, screen time, Google
  (Gmail, Tasks, Drive):** iOS gives apps no access to other apps' notifications, texts, call log,
  alarms or system switches; Google sign-in isn't set up for iOS. Shown as "Not possible on iPhone"
  (Google ones: "Not on iPhone yet: Google sign-in isn't set up for iPhone").
- **Natural voice (Pocket TTS):** not ported (ONNX Runtime iOS build not added); the iPhone's own voice
  reads answers.
- **GPU/NPU for the model:** the LiteRT-LM xcframework used (checked with v0.19.1; the app now uses v0.20.0) is CPU only for the Swift API;
  the iPhone downloads only the generic model (3.0 GB vs 3.5 GB on Android).
- **Background audio mode** (`UIBackgroundModes: audio`) removed: the iPhone app answers only while
  open, and Apple rejects background modes an app doesn't need.
- **China mainland:** not offered (App Store availability). Generative AI apps there need a CAC
  Security Assessment and an AIGC filing through a local entity, which a free open-source app can't do.
- **Android wording (26 Nov polish):** every text that differs by platform lives in
  `src/engine/platform-text.ts` (Face ID / passcode, App Store, "Save to Photos" instead of
  Pictures/Sidekick folders, location only "while Sidekick is open"); `__tests__/ios-wording-test.tsx`
  renders the settings screens as an iPhone and fails on Android-only words. Replies no longer say
  "needs Android": they say what the iPhone can't do and what to do instead. Left Android-only:
  "Understand other languages around me" (Listen only; Apple Speech hears the question), conversation
  notes, "Read new messages aloud", the AI chip section (CPU only), video / stills / conversation
  audio keep periods. The privacy policy and changelog cover both phones and are unchanged.
- **Download after the app is killed:** the background download continues while the app is
  suspended, but if the user force-quits Sidekick it restarts on the next open (no resume data kept).

## Voices and transcription bench (26 Nov; details in docs/BENCH.md)

- Built: lines are cut where the voice changes (pauses ≥ 0.25 s, 2 s blocks in non-stop speech,
  cut when similarity < 0.4); reply-expected name cues wait for the reply; three more intro cues.
- Rejected: same-voice threshold 0.6 (from 0.55). Slightly better in clean audio (named 45% → 50%)
  but worse with room echo; kept 0.55.
- Rejected: cutting at short pauses without word timing (each part transcribed alone). Splits people
  as well, but words on cut parts got much worse (WER 7% → 18.5% in babble at 10 dB).
- Left: similar voices merging across conversations, misheard unusual names, overlapping speech in
  one line, and loud babble (5 dB and below) where words and voices both fall apart.
- Built (descriptions): short pieces that sound alike (≥ 0.5) add up to a new person once they
  total 2.5 s, so people who only say short things get a voice and a role instead of "Someone".
  The voice bench now scores names and descriptions together.
- Rejected: 0.55 or 0.6 for "sound alike" when adding up short pieces (fewer people found, more
  "Someone"); kept 0.5.

## Future option: separate profiles (owner, 26 Nov)

- Fully separate spaces in the app (own chat, notes, people, memories), e.g. for a shared phone or
  work vs home. Not built now: the one continuous chat should work well on its own, and the owner
  doesn't want hard-coded splits. Revisit if users ask.
- Separate chats were left out for the same reason; the assistant should find the right context
  itself.

## Robustness fixes (26 Nov; details in docs/BENCH.md)

- Built: voices that haven't agreed (consent mode) are kept in memory for the conversation only,
  never stored; old stored ones without a kept line are removed at start.
- Rejected: deleting a person page the user named or wrote notes about when removing a voiceprint
  that never agreed; the page stays, without the voiceprint (what the user wrote is theirs).
- Built: conversation context in voice matching (a young voice heard in the last 10 min joins from
  0.45). Rejected: 0.4 (babble 5 again-later 48% → 44%), 0.5/0.55 (fewer splits fixed), applying it
  to every recent voice (more cross-scene merges). Left: in clean audio one more cross-scene merge
  (Femi joins the café waiter), the known similar-voices weakness.
- Built: Android memory signals free the embedder (low) or both models (critical; the chat model
  only when idle). Left: the Pocket voice model (once used it stays loaded; freeing it while a
  sentence is being made on its thread could crash, so it needs its own idle hook first).
- Built: two free-space levels. Rejected: refusing photos the user takes as soon as space is under
  the reserve (they would be refused with gigabytes free); only under the 500 MB / 1% floor.

## Share in, web pages, text tools, "What did I miss?" (26 Nov)

- **Later: iPhone share extension and text tools.** Sharing files into the iPhone app and an "Ask
  Sidekick" action on selected text need native extension targets (Share / Action extension), an
  App Group to hand files to the app, and extra EAS provisioning profiles; none can be tested here
  without an iPhone. Cheapest first step when there is one: `CFBundleDocumentTypes` (Open in
  Sidekick) for any file, then a share extension. Until then the chat's paperclip attaches files
  on the iPhone. The iPhone app still reads links pasted
  into the chat, and pictures from the screenshot share.
- **Later: "What did I miss?" on iPhone.** iOS gives apps no access to other apps' notifications.
- **Rejected: a readability library** (Mozilla Readability, `@mozilla/readability`, Apache-2.0) for
  web pages. It needs a DOM (jsdom or linkedom) in React Native, adding megabytes and parser
  dependencies for one feature. Sidekick's own extraction (`src/web/page-logic.ts`) keeps headings,
  paragraphs and list items that are not mostly links, which is enough for articles and Wikipedia.
  Pages built by scripts (apps, some news sites) give no text and say so.
- **Not saved: text tools results.** Text selected in another app is often someone else's message;
  the proofread or rewrite is shown, copied or sent back, never kept in memory.
- **Kept to one pass: shared documents over ~190,000 characters** (24 parts). The rest is left out
  and the answer says so; reading more parts would take minutes on the Pixel 5 per question.
- ~~Left out: video files~~ — built 27 Nov (see "Any file" below).

## Any file: attach, share in, folders (27 Nov)

One set of readers (`src/files/`, pure TypeScript plus fflate for unzipping) reads every file that
comes in: the paperclip in the chat (system file picker, both phones), Share to Sidekick (Android)
and folder sources. PDFs, Word/PowerPoint/OpenDocument, Excel (.xlsx, old .xls), .ods, CSV/TSV,
EPUB, RTF, HTML, JSON/XML/logs and text; zips list their files and read the readable ones inside;
pictures go to the shared-picture path (sight + text in it); recordings and videos to the
recording reader; anything else gets a plain line saying what it is and how big.

- **Spreadsheets are worked out in code.** The model writes one Excel formula (tool `query_sheet`,
  offered only while a sheet is attached, with its columns in the description), and
  `src/files/formula.ts` works it out exactly: a sandboxed evaluator (no `eval`, no file or network
  access, step, time, size and depth limits) with ~140 Excel functions including SUMIFS, XLOOKUP,
  FILTER, GROUPBY, PIVOTBY, LET and LAMBDA. A formula that fails is asked for once more with the
  reason; the answer shows the formula used. "Add a column" changes the attached sheet, which can
  be saved as CSV (share sheet). Rejected: existing formula engines — HyperFormula is GPL-3.0 or
  paid; formula.js and fast-formula-parser bring lookup/array gaps and no sandbox limits.
- **Video:** four still pictures (Android `MediaMetadataRetriever`, iPhone `AVAssetImageGenerator`)
  described by the chat model on the first question (~25 s each on the Pixel 5 CPU), and the
  speech read like a recording (Android). **iPhone: no speech from videos or recordings** (the
  recording reader is Android only); the pictures still work, and the answer says the speech
  can't be read there.
- **Limits (Pixel 5, 6 GB):** files read in pieces through a file handle, never whole except old
  .xls (≤ 40 MB) and CSV (≤ 60 MB); one XML part ≤ 40 MB unpacked; 400,000 characters kept;
  sheets ≤ 1,000,000 cells / 200,000 rows / 500 columns; zips read ≤ 30 files of ≤ 20 MB each
  (zip bombs stop at the cap); attachments ≤ 400 MB; folder documents ≤ 30 MB.
- **Not read:** old Word (.doc) and PowerPoint (.ppt) binary files, Excel 95 and older, and
  password-protected files: each says so plainly ("save it as .docx"). Folder sources don't read
  pictures, recordings, videos or zips (too slow for a background scan).
- **Rejected: 3D model previews** (.glb, .obj, .stl) — a gimmick for an assistant; the file is named
  as a 3D model with its size.
- **iPhone:** the paperclip reads every type above; sharing into the app still needs the share
  extension (Later, above).

## Lite versions of cloud-app features (26 Nov; numbers in docs/BENCH.md "Lite features")

### Image generation (built, Android; optional download)

**Licence search: is there a model with no use restrictions?** Checked against each model's
licence file or card on Hugging Face (Nov 2026):

| Model (size)                                                     | Licence (source)                                                                                                              | Usable here?                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| MiniT2I-B/16 (0.26 B; 280 MB at 8-bit) + flan-t5-large (830 MB)  | MIT (huggingface.co/MiniT2I/MiniT2I) + Apache-2.0 (huggingface.co/google/flan-t5-large)                                       | Licence: yes, no restrictions. Speed: no (measured below)                                           |
| PRX-512 (Photoroom, 1.3 B)                                       | Apache-2.0, but ships Google's T5-Gemma text encoder under the Gemma Terms (huggingface.co/Photoroom/prx-512-t2i-sft, NOTICE) | Gemma's prohibited-use policy carries over; 1.3 B + 2 B encoder is too big and slow for the Pixel 5 |
| Sana 600M / Sana-Sprint 0.6B (Nvidia)                            | Apache-2.0 weights, Gemma-2-2B-IT text encoder under the Gemma Terms (model cards)                                            | Same: Gemma terms; 2 B encoder                                                                      |
| Lumina-Image-2.0                                                 | Apache-2.0 (Gemma-2 text encoder)                                                                                             | Same; 2.6 B + encoder: too big                                                                      |
| FLUX.2-klein-4B, iris-3b, Z-Image-Turbo (6 B), Qwen-Image (20 B) | Apache-2.0                                                                                                                    | Licence fine; 3–20 B: far too big for a 2020 phone                                                  |
| SDXS-1B / SDXS (AiArtLab)                                        | "modified-mit": non-commercial without written permission (huggingface.co/AiArtLab/sdxs-1b, LICENSE)                          | No                                                                                                  |
| Anima, SeFi-Image, flux-3-image-klein                            | Non-commercial / gated community licences                                                                                     | No                                                                                                  |
| SDXS-512 (IDKiro; 683 MB at 8-bit)                               | CreativeML OpenRAIL++-M (from SD 1.5 / DreamShaper, CreativeML OpenRAIL-M)                                                    | Yes, commercial use allowed; users must be bound by the use restrictions (Attachment A, §5)         |
| SD 1.5 / BK-SDM / SD 2.1 family                                  | CreativeML OpenRAIL-M / OpenRAIL++-M                                                                                          | Same conditions as SDXS-512; slower (SD 1.5 + LCM: 240 s on the Pixel 5)                            |
| SD-Turbo, SDXL-Turbo, SD 3 / 3.5                                 | Stability AI Community Licence                                                                                                | No: registration, attribution, revenue cap                                                          |
| TAESD decoder (10 MB)                                            | MIT (huggingface.co/madebyollin/taesd)                                                                                        | Yes                                                                                                 |

The only unrestricted model small enough was MiniT2I. Measured with stable-diffusion.cpp on the
laptop: 8.7 s per step, and it needs about 20 steps for a clean picture (fewer steps are mush);
about 3 minutes a picture on the laptop, so roughly 5 minutes or more on the Pixel 5 (estimated; MiniT2I is not in the app, so it was not timed on the phone; SDXS-512 in the app takes 30–32 s a picture there). Not usable. **Decision: SDXS-512 under OpenRAIL++**, with its
Attachment A passed on word for word in the picture terms (docs/picture-terms.md, shown in
Settings → Assistant → Make pictures and agreed to by downloading) and the licences linked in
THIRD_PARTY_NOTICES.md.

**What was built**

- stable-diffusion.cpp (MIT) and ggml built from source in the native module's CMake, pinned by
  commit and SHA-256 (sd.cpp e637c7b, ggml eeda9ec), ARMv8.2 dot-product + fp16 (checked on the
  CPU before loading; older CPUs are told no). The unused tokenizer vocabularies (Qwen, Mistral,
  T5, Gemma) are left out: the library is 12.5 MB instead of 41 MB.
- Optional download (0.7 GB, Wi-Fi unless mobile data is allowed): offered on Android phones
  with 6 GB+ RAM; 4–6 GB get it with a "slow on this phone" note; under 4 GB, old CPUs and the
  iPhone ("not yet") don't.
- The model picks the `make_picture` catalog tool from what was said, in any wording (no word
  lists). It is always offered: without the picture model the answer offers the download, and on
  the iPhone (not yet) or a phone that can't draw it says so plainly. (Offered only once
  downloaded, a drawing request on the iPhone went to a web search instead.) Erase and upscale are `edit_photo` operations, offered only with a photo.
  Progress in the chat, Stop works mid-picture, and the
  picture is kept in the chat history and the timeline ("Picture Sidekick drew"); off the record
  it isn't kept. Gemma is unloaded first on phones under 7 GB.
- Each picture has **Report this picture**: pick a reason in the app, then it opens an email draft
  to support with the reason and what was asked for (no picture attached, nothing sent without
  the user).

Speed: 37–43 s a picture on the Pixel 5 with the same model and settings in the earlier trial (docs/BENCH.md "Lite features"); the in-app build, timed on the Pixel 5 (27 Nov, 6 pictures): 29.6–31.9 s to draw, plus about 2 s for the safety check; peak app memory 3.3 GB with the chat model still loaded. The first phone run found every picture failing in the release build (R8 had renamed the progress callback the native code calls by name); fixed with a keep rule.

**Content filter: only what store policy requires.** Google Play's AI-Generated Content policy
(support.google.com/googleplay/android-developer/answer/13985936) says apps that generate
content with AI, including "Image or video generated by AI based on text, image, or voice
prompts", must comply with its content policies, "prohibiting and preventing the generation of"
Restricted Content (child exploitation is the example given; the examples page,
answer/14094294, adds non-consensual sexual deepfakes and sexually gratifying apps), and "must
contain in-app user reporting or flagging features" so users can report offensive content
"without needing to exit the app". So Sidekick refuses sexual or nude pictures, and anyone under 18 in a sexual
or suggestive way, and has the Report button. The model judges this, not a word list: after it
picks `make_picture`, a short scratch-chat check asks it yes or no about the request and its
description (picture.ts `pictureAllowed`), so rewordings and other languages are caught and "a
sexy sports car" is not refused. It fails closed: anything but a clear "no" (an unreadable reply,
a failed call) refuses. A word list was tried first and dropped (owner rule: no word rules;
brittle both ways). Nothing
else is filtered: violence, politics, real people and so on are left to the licence terms and
reports. Risk noted: the report is picked in the app but sent from the email app; if review
objects, an in-app send needs a server, which Sidekick doesn't have.

**Left out**

- iPhone: needs a Core ML or Metal build of the same model; the app says "not yet".
- A filter beyond sexual content, and an image classifier on the output (not required; it would
  add a model and wrong refusals).
- Bigger or better models (SD 1.5 + LCM, 4 steps: 240 s; anything 1 B+): too slow on the Pixel 5.
- CI time: building sd.cpp adds about 7 minutes to a cold Android build (cached after).

### Light photo edits (built, Android)

- Built: rotate, flip, crop to a shape, black and white, enhance, and background remove / white /
  colour / blur, picked by the model from what was said. Background cut-out: U²-Netp
  (Apache-2.0, 4.6 MB) chosen over Silueta (44 MB, about the same masks) and ISNet (179 MB,
  ~6× slower on the laptop).
- **Erase an object** (built 26 Nov): asking to remove something from a photo answers with a
  "Brush over it" button; the brush screen marks the object and MI-GAN (MIT, 28 MB, downloaded
  the first time) fills it in, with undo and "erase more". Pixel 5: 2.3–2.7 s for a 1536 × 1536 photo (27 Nov).
  LaMa (Apache-2.0, 200 MB) was not tried: 7× the download for a phone-sized photo.
- **Upscale** (built 26 Nov): Real-ESRGAN general x4v3 (BSD-3, 5 MB), 4×, in 128 px tiles. Only
  offered for photos with a long edge of 1024 px or less (bigger ones get "it's already W × H");
  phone camera photos are already 12 MP. Pixel 5: 21.8–21.9 s for 512 → 2048 px (27 Nov).
- iPhone: not yet (the edits need a Swift port; the app says so and still answers about the photo).

### Chat models: abliterated or user-chosen (notes only)

Owner decisions (26 Nov), verbatim:

- "Uncensored or abliterated models: left out for now because of store rejection risk. Note it
  only."
- "'Use your own chat model': rejected. Sidekick should ship the best model for users rather than
  let them pick one."

What it would take, if this is reopened:

- Format: Sidekick runs Gemma through LiteRT-LM (.litertlm). An abliterated Gemma would have to be
  converted to .litertlm with Google's converter (possible for Gemma-architecture weights, not
  tested); anything else needs llama.cpp in the native module, which on the Pixel 5 is slower
  than LiteRT-LM's GPU path for the same size (several seconds more per answer).
- Licence: an abliterated Gemma is a Gemma derivative; the Gemma Terms and Prohibited Use Policy
  carry over to it and must be passed on to users, so it would not be "unrestricted" either.
- Stores: Google Play's AI-Generated Content policy requires preventing restricted content and
  in-app reporting; the App Store's guideline 1.2 (user-generated content) and 1.1 (objectionable
  content) apply too. A model sold as uncensored is a likely rejection.

### Research (built)

- Built: the model plans up to 4 searches over the existing sources (Wikipedia, DuckDuckGo,
  SearXNG if set, news sources for news), the phone reads up to 6 pages and writes a short report
  with numbered sources. Only search words and page requests leave the phone.
- Limits chosen for the 4,096-token window, the Pixel 5 and Wikimedia's 10 requests a minute: up to 4 searches (3 when the minute's budget is fresh), 6 pages, 4,400
  characters of passages, ≤ 200-word report. More pages would not fit the window.
- Left out: following links inside pages, and searching again after reading (each extra model
  pass costs ~6 s plus writing time on the Pixel 5).

### Other cloud-app features considered (Part C)

Already in Sidekick: memory, voice conversation, photo questions, reminders/routines (scheduled
tasks), off the record (temporary chat), copy/share, model choice, maps/location, Drive backup.
Built now: "what can you do?" mentions research and photo edits.

| Feature (ChatGPT / Gemini / Claude)         | Decision and why                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Suggested follow-up questions under answers | Left out: one more model pass (~5 s on the Pixel 5) after every answer, competing with the spoken reply. |
| Projects / custom instructions              | Left out: saved facts already shape answers; separate spaces are the "profiles" option above.            |
| Canvas (edit a document side by side)       | Later: a large new screen; the 4k window limits long documents anyway.                                   |
| Branching chats                             | Left out: the one continuous chat is the design (see "separate profiles").                               |
| Study / quiz mode                           | Not needed: Gemma does this when asked in the chat.                                                      |
| Code interpreter / data analysis            | Left out: no safe sandbox on the phone; sums and conversions already run in code.                        |
| YouTube / video summaries                   | Left out: needs YouTube's transcripts (against its terms without the API, and the API needs a key).      |
| Agent mode (browsing, filling forms)        | Out of scope (SPEC: no autonomous agents; actions need the user's OK).                                   |
| Custom GPTs / plugins marketplace           | Left out: accounts and servers.                                                                          |

## The model understands, code computes (27 Nov; details in docs/BENCH.md)

Owner: "It should be dynamic and intelligent, hardcoding is brittle, unless it's always better
like doing calculations etc., but that should probably be a hand-off. We want as few rules and
bloat/context in the chat as possible, to maximise intelligence, speed, efficiency, battery
usage." Accuracy wins over speed ("better to be slow than unreliable").

- **Built:** every request goes through one short model pass, the "catalog" sorter (decide.ts):
  its system prompt is the tool list with one line each (~560 tokens), kept read in a second
  prefix cache next to the chat's, and it replies with one word (answer, lookup, news, or a tool).
  Then the model fills that one tool's arguments (it may still say none), code checks them against
  the schema (a refused call is asked once more, with the reason), and the tool runs. Sums, units,
  dates and time zones are tools that compute in code (`src/integrations/compute.ts`). What is
  offered follows the app's state only: "draft" (send or cancel) only while a draft waits;
  routines never get sending, calling back, moving events, the clipboard, or phone controls; with
  the phone locked only lock-safe calls run (decide-logic.ts lockSafe).
- **Removed:** the rule tracer and every word list that read the user's words to choose what to
  do: phone commands ("stop listening", speech speed, camera), phone controls, extras, texts and
  calls, intents, scheduled sends, quick answers, translate, recap requests, feedback, read-back
  yes/no, lookup and news detection, the browser-link rule and the date-line rule. 454 word-list
  regexes (4,138 alternatives) in src before, 205 (1,927) after.
- **Tried and rejected** (Pixel 5, 199 cases): fused (the answer pass also says DO/LOOKUP:
  misses actions), fused-lookup (73/199: LOOKUP on knowledge and date questions), classify
  without descriptions (113/199), the full tool catalog in the answer prompt (slow, long
  prompt), embedding nearest-neighbour (needs labelled examples per wording), and the old rules
  (143/143 on the set they were tuned to; on the 56 new wordings a rule decided only 26, 4 of
  them wrongly, and the rest waited ~5 s or more for the router). The catalog: 172/199, median
  1.7 s.
- **Known gaps:** multi-step chains ("check the forecast and text Sam") are gone: one tool per
  request. Recall helpers on the answer path still use word lists (recall intents, "something
  seen", follow-ups, speech clips, people context, the unusual-time-words check); the handlers
  for reminders, routines, location and weather still parse the canonical words tools.ts writes
  for them (never the user's). Both are next.
- **Thinking: default (off) kept, not yet measured.** Benches are built (thinking off / budget /
  no limit / a THINK hand-off on 24 questions; background tasks with a budget on 15), but the
  phone stayed locked whenever this work had it. Thinking is switched on only if the data shows a
  clear win. iPhone: the bundled Swift LiteRT-LM has `ThinkingConfig`; `Llm.swift` doesn't pass
  it yet.

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

- **Pocket TTS on the Pixel 5:** first sound 3.8–4.3 s per sentence while Gemma is still writing (laptop: 0.6 s; voice-sample length makes no difference). The app falls back to the system voice automatically when a short sentence takes over 2.5 s. Faster phones keep Pocket.

- **expo-notifications pulls in firebase-messaging:** it is inactive and makes no network connections. It is still in the APK.
- **OCR models stay loaded once used:** ~31 MB, and nothing calls `ocrUnload` yet.
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
- Gap: lines under 2.5 s from a voice not yet known stay "Someone" (too short to start a voice; see voices.ts). Each reading takes seconds of CPU on the Pixel 5 while speech-to-text and the voice also run (Pocket's first sound rose to 3–6 s during these tests).

## Spoken reminders (2026-11-24)

- "Remind me (to/about) … <time>" is parsed by rules (`parseReminderRequest`) and scheduled at once, with no model call. Before, Gemma replied "I have set a reminder" while nothing was scheduled (follow-ups only came from the background suggestion pass).
- No time said → an undated to-do, and the reply says so. "Remind me what / where / who …" is a question, answered normally.
- Rejected: letting Gemma decide via a tool call (slower on the Pixel 5 and can still claim success without acting).
- Verified on the Pixel 5: "Remind me to call the dentist tomorrow at nine" → alarm at 09:00 next day, reply at 0 ms. Without "Allow exact reminders" in Settings, Android may fire it up to 1 hour late.

## Smaller fixes from phone tests (2026-11-24)

- Questions to Sidekick are no longer read for follow-ups: they turned into to-dos ("Find capital of France") and re-suggested reminders already set. Only things said around you and photo notes are.
- A screenshot from the assist key is used only for questions within 2 minutes, then dropped.
- Turning the Folders source on now reads the picked folder at once (before: only "Add a folder" did).
- Verified on the Pixel 5: a text PDF and a scanned (image-only) PDF in a folder source were both found and answered from (6.7 s / 5.4 s). Default assistant (assist key) and the Quick Settings tile open Sidekick; the widget is registered (not placed).

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
- Gap: the hidden "LOOKUP" turn stays in Gemma's history on spoken follow-ups.
- Gap: Gemma's search words on a Pixel-5-class CPU may often miss the 1.5 s budget (then rules are used); a `[lookup]` log line now shows which was used and the timings.
- Measured on the Pixel 5 (Wi-Fi, UK): "who won the 2022 world cup?" answered from Wikipedia in 9.6 s (lookup ~2.5 s). GDELT took 9 s+ to answer at all (even its 429 "busy" reply), so with a 4 s limit news questions got no news source. News questions now wait up to 9 s for GDELT; others keep 4 s.

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

- **Barge-in has no voiceprint check:** anyone speaking can interrupt an answer.
- **expo-notifications pulls in firebase-messaging:** it is inactive and makes no network connections. It is still in the APK.
- **OCR models stay loaded once used:** ~31 MB, and nothing calls `ocrUnload` yet.
- **iOS:** deferred. No OCR, assistant role, tile or widget there yet.

## Later (not built yet)

- **PDF reading in folder sources:** Android `PdfRenderer` plus OCR.
- **Smart Turn v3 end-of-turn detection:** via the same ORT bridge. Today the end of a turn is decided by VAD silence.
- **Voiceprint check for barge-in.**

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
- Gap: Gemma's search words on a Pixel-5-class CPU may often miss the 1.5 s budget (then rules are used); not yet measured on a phone.

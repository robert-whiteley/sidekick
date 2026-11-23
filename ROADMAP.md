# Roadmap

Each milestone reports what was verified **on a device** vs only built.

1. **Foundation** — repo hygiene, docs, CI, public repo.
2. **Android MVP (Pixel 5)**
   1. Model download manager (resume, pinned SHA-256, Wi-Fi notice).
   2. Ask screen: camera preview, button, typed input, Gemma 4 E2B vision answer streaming + TTS.
   3. Native listen service: VAD + "hey sidekick" keyword spotting + Moonshine v2 STT + speaker embeddings / clustering.
   4. Memory DB: encrypted, vector search; captures + transcripts + location.
   5. Recall with re-read of the original image.
   6. Settings: toggles, consent mode, auto-pause, export, delete.
3. **iOS build** of the same via EAS, tested on iPhone 13 mini.
4. **Then:** follow-ups, people pages, folders / contacts / calendar, web search, Android assistant role, image embeddings, OCR, daily digest.

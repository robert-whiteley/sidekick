# Architecture

## Layers

| Layer              | Tech                                                                                                                               | Why                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| UI + orchestration | Expo (React Native, new architecture, Expo Router, CNG + config plugins)                                                           | One UI codebase; iOS builds from Linux via EAS; maintained bindings for every engine below        |
| Always-on audio    | Local Expo module `modules/sidekick-native` (Kotlin, then Swift) running a foreground service with sherpa-onnx; emits events to JS | Wake word, VAD and transcription must keep running with the screen off and without JS overhead    |
| LLM / vision       | Google LiteRT-LM with Gemma 4 E2B (`.litertlm`) — ADR 4                                                                            | Uses each phone's fastest hardware (Tensor NPU, GPU, CPU fallback); Google-maintained; Apache-2.0 |
| Speech             | sherpa-onnx: Silero VAD, keyword spotter, Moonshine v2 STT, 3D-Speaker embeddings, offline diarization                             | One Apache-2.0 runtime for all speech tasks; open-vocabulary wake word with no training           |
| Voice out          | System TTS (`expo-speech`)                                                                                                         | Zero download, fast on old phones. Later: Kitten / Piper via sherpa-onnx                          |
| Memory             | `@op-engineering/op-sqlite` with SQLCipher + sqlite-vec; EmbeddingGemma 2 for text embeddings                                      | Encrypted, fast, vector search in the same DB. USearch (HNSW) later for millions of vectors       |
| Camera             | `expo-camera`                                                                                                                      | Photo capture is all the MVP needs; vision-camera later if live frame processing is added         |
| Places             | GeoNames cities15000 (offline) + learned places (home/work from dwell time)                                                        | Place names with no network                                                                       |

## Memory model

- Store snapshots, audio and transcripts long-term; full video only for the recent past (years of video is ~10 GB/day — not feasible).
- Estimated ~1.6 M frame vectors per year (1 per 10 s × 12 h/day) ≈ 300 MB/yr at 256-dim int8.
- Recall: hybrid search (vector + OCR text + keyword) → pick the moment → re-read the original image with the VLM for detail questions.

## Memory budget

On phones under 6 GB RAM (iPhone 13 mini) the LLM and the embedder are never resident together: embedding unloads the LLM first. The iOS build uses the `increased-memory-limit` entitlement.

The chip is chosen by measurement, not by a list: the first run times every backend that loads (one-token check, then a fixed prompt) and saves the fastest. On the Pixel 5 the GPU loads but writes slower than the CPU (2.9 vs 5.0 tokens/s), so it picks CPU. Measured on Pixel 5: typed question with memory ≈6 s, photo question ≈30 s.

## Listening

- A foreground service (Android, microphone type, permanent notification) owns one microphone loop shared by background listening and hold-to-talk.
- Per 32 ms chunk: wake-word spotter + Silero VAD. Each speech segment is transcribed (Moonshine) and voiceprinted (CAM++) on a worker thread.
- Results go to an append-only journal file; the app drains it into the encrypted database when it is open. While the app is not on screen, the service answers wake-word questions itself (same model, same prompt) and speaks with the system voice.
- Consent mode (default on everywhere): other people's speech is kept only after the owner asks for consent and that voice says yes within 30 s. The owner's voice is learned from hold-to-talk and wake-word questions.

## Platform limits

**iOS:** no background camera; no custom wake word in the background (use side button voice-app setting, Back Tap, Siri / App Intents, widget); background mic is allowed if started in the foreground (`audio` background mode, orange dot — App Review 2.5.4 / 2.5.14 need detailed review notes); no reading other apps' screens (share sheet, or a ReplayKit broadcast extension with a 50 MB cap); no notification / SMS / call-log access; no background GPU.

**Android:** camera / microphone foreground services must start while the app is visible; a mic FGS cannot start from `BOOT_COMPLETED` (Android 15+); the default-assistant role (Assist API) is the legitimate screen-context route; MediaProjection needs consent each session; AccessibilityService only for sideload builds; `MANAGE_EXTERNAL_STORAGE` is not allowed on Play → use SAF; native libraries must support 16 KB pages (targetSdk 35+).

Core features must work on both platforms; Android-only extras are optional.

## Security

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

# Architecture

## Layers

| Layer              | Tech                                                                                                                               | Why                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| UI + orchestration | Expo (React Native, new architecture, Expo Router, CNG + config plugins)                                                           | One UI codebase; iOS builds from Linux via EAS; maintained bindings for every engine below               |
| Always-on audio    | Local Expo module `modules/sidekick-native` (Kotlin, then Swift) running a foreground service with sherpa-onnx; emits events to JS | Wake word, VAD and transcription must keep running with the screen off and without JS overhead           |
| LLM / vision       | `llama.rn` (llama.cpp) with Gemma 4 E2B + mmproj                                                                                   | Best small open vision model with a commercial-safe licence; streaming, tool calls, speculative decoding |
| Speech             | sherpa-onnx: Silero VAD, keyword spotter, Moonshine v2 STT, 3D-Speaker embeddings, offline diarization                             | One Apache-2.0 runtime for all speech tasks; open-vocabulary wake word with no training                  |
| Voice out          | System TTS (`expo-speech`)                                                                                                         | Zero download, fast on old phones. Later: Kitten / Piper via sherpa-onnx                                 |
| Memory             | `@op-engineering/op-sqlite` with SQLCipher + sqlite-vec; EmbeddingGemma 2 for text embeddings                                      | Encrypted, fast, vector search in the same DB. USearch (HNSW) later for millions of vectors              |
| Camera             | `react-native-vision-camera` 5                                                                                                     | Frame access for capture and vision                                                                      |
| Places             | GeoNames cities15000 (offline) + learned places (home/work from dwell time)                                                        | Place names with no network                                                                              |

## Memory model

- Store snapshots, audio and transcripts long-term; full video only for the recent past (years of video is ~10 GB/day — not feasible).
- Estimated ~1.6 M frame vectors per year (1 per 10 s × 12 h/day) ≈ 300 MB/yr at 256-dim int8.
- Recall: hybrid search (vector + OCR text + keyword) → pick the moment → re-read the original image with the VLM for detail questions.

## Memory budget

The iPhone 13 mini has 4 GB RAM. Never keep the LLM and the embedder resident together; load on demand. Consider the `com.apple.developer.kernel.increased-memory-limit` entitlement.

Pixel 5 GPU/DSP are not usable by these runtimes → CPU only. Expect ~25–40 s per photo question with Gemma 4 E2B on Pixel 5 (≈2 s on a current flagship).

## Platform limits

**iOS:** no background camera; no custom wake word in the background (use side button voice-app setting, Back Tap, Siri / App Intents, widget); background mic is allowed if started in the foreground (`audio` background mode, orange dot — App Review 2.5.4 / 2.5.14 need detailed review notes); no reading other apps' screens (share sheet, or a ReplayKit broadcast extension with a 50 MB cap); no notification / SMS / call-log access; no background GPU.

**Android:** camera / microphone foreground services must start while the app is visible; a mic FGS cannot start from `BOOT_COMPLETED` (Android 15+); the default-assistant role (Assist API) is the legitimate screen-context route; MediaProjection needs consent each session; AccessibilityService only for sideload builds; `MANAGE_EXTERNAL_STORAGE` is not allowed on Play → use SAF; native libraries must support 16 KB pages (targetSdk 35+).

Core features must work on both platforms; Android-only extras are optional.

## Security

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

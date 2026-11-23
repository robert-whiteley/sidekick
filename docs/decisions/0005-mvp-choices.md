# 5. MVP choices made while building

Date: 2026-11-23

- **Camera:** `expo-camera` instead of vision-camera. The MVP only takes photos; no frame processors needed.
- **Embeddings:** EmbeddingGemma 2 (256 dims) through LiteRT-LM's `EmbeddingEngine`, so one runtime serves the LLM and the embedder.
- **Memory residency:** the embedder unloads the LLM first only on phones under 6 GB RAM; bigger phones keep both.
- **Chip choice:** measure every working backend once and keep the fastest (ADR 4 listed a fixed order).
- **Consent mode:** "Automatic" by default: on where recording law needs everyone's agreement (EU/EEA, CH, AU, all-party US states, or unknown place), off elsewhere; region from the nearest bundled GeoNames city, else SIM/network/locale country. User can force On or Off.
- **Listening:** a native foreground service writes a journal file; JS ingests it. This keeps the mic working with the app closed and JS asleep.
- **Speech-to-text:** NVIDIA Parakeet TDT 0.6B v2 (int8, CC BY 4.0), measured on 73 LibriSpeech clips with 2 CPU threads: word error 2.9% clean / 24% degraded, vs Moonshine v2 base 7.5% / 72% and Parakeet 110M 4.6% / 49%. ~7x real time on PC.
- **Wake word model:** the standard gigaspeech KWS build; the `-mobile` build crashes sherpa-onnx 2.0.2 on any audio.
- **Speech-to-text on the Pixel 5:** Parakeet transcribes at ~0.25x real time after loading (6 s clip in 1.5 s, ~16 s clip in 3.9 s), fast enough to stay.
- **Speech detection:** Silero VAD v5 (MIT). On 9.4 min of LibriSpeech with noise it false-alarms 0.1–1.6% vs 11–29% for the older Silero file, at the cost of up to 6 points more missed speech in heavy noise. TEN VAD was rejected: its licence bans competing with Agora.
- **Kept after benchmarks:** CAM++ voiceprints (best on noisy 4 s clips, 1.7% EER), the gigaspeech wake-word model (0 false wakes in 52 min), Gemma 4 E2B (E4B is ~2x slower and too big for 4 GB; Qwen3.5-2B is only slightly better on images and worse on text without slow "thinking"), EmbeddingGemma 2 at 256 dims (67.8 vs 68.5 MTEB at 768).
- **Photos for the model:** camera photos are shrunk to 768 px and turned upright before the model sees them. The full 12 MP file reached the model as a black image, and the small one also answers in ~40 s instead of ~90 s.

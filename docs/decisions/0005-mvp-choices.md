# 5. MVP choices made while building

Date: 2026-11-23

- **Camera:** `expo-camera` instead of vision-camera. The MVP only takes photos; no frame processors needed.
- **Embeddings:** EmbeddingGemma 2 (256 dims) through LiteRT-LM's `EmbeddingEngine`, so one runtime serves the LLM and the embedder.
- **Memory residency:** the embedder unloads the LLM first only on phones under 6 GB RAM; bigger phones keep both.
- **Chip choice:** measure every working backend once and keep the fastest (ADR 4 listed a fixed order).
- **Consent mode:** on by default in every region.
- **Listening:** a native foreground service writes a journal file; JS ingests it. This keeps the mic working with the app closed and JS asleep.

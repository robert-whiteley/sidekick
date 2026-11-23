# 3. On-device models

Date: 2026-11-23 · Status: accepted

## Decision

All models must allow commercial use. Downloads are verified against pinned SHA-256 hashes.

| Task               | Model                                                           | Licence    | Size    |
| ------------------ | --------------------------------------------------------------- | ---------- | ------- |
| Chat + vision      | `ggml-org/gemma-4-E2B-it-GGUF` → `gemma-4-E2B-it-Q4_0.gguf`     | Apache-2.0 | 2841 MB |
| Text embeddings    | `ggml-org/embeddinggemma-2-GGUF` → `embeddinggemma-2-Q8_0.gguf` | Apache-2.0 | 310 MB  |
| VAD                | Silero VAD                                                      | MIT        | small   |
| Speech-to-text     | Moonshine v2 English (streaming/English models are MIT)         | MIT        | small   |
| Wake word          | sherpa-onnx keyword spotter (open vocabulary)                   | Apache-2.0 | small   |
| Speaker embeddings | 3D-Speaker CAM++ / ERes2Net                                     | Apache-2.0 | small   |

Image embeddings: LiteRT-LM `EmbeddingEngine` with `litert-community/embeddinggemma-2-text-vision-440m-litert-lm` (Apache-2.0, 388 MB), which also replaces the text-only embedder (see ADR 5).

## Rejected (licence)

FastVLM, MobileCLIP2 (Apple research licence); openWakeWord pretrained models (CC BY-NC-SA); Porcupine (proprietary); LFM2.5-VL (revenue cap); Screenpipe (commercial licence); ChatterUI (AGPL); Dicio (GPL); sqliteai SQLite-Vector (Elastic 2.0).

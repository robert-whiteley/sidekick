# 4. LiteRT-LM as the on-device LLM engine

Date: 2026-11-23 · Status: accepted · Supersedes the `llama.rn` part of ADR 2

## Context

`llama.cpp` (via `llama.rn`) accelerates only on Qualcomm Adreno GPUs and Apple Metal; it cannot use Google Tensor's TPU or most other phone NPUs. Google's LiteRT-LM (Apache-2.0) runs Gemma 4 on CPU, GPU (OpenCL / Metal) and NPU, and Google publishes precompiled Gemma 4 E2B builds for Tensor G5/G6.

Published Gemma 4 E2B numbers (LiteRT-LM model card, 1024-token prompt): Galaxy S26 Ultra GPU 3,808 tok/s read / 52 tok/s write, 0.3 s to first token; iPhone 17 Pro GPU 2,878 / 56.

## Decision

- Android: `com.google.ai.edge.litertlm:litertlm-android` (pinned) inside `modules/sidekick-native`, our own thin Expo module (third-party RN bindings are small projects).
- iOS: LiteRT-LM Swift package (Metal) in the same module, once the Android MVP works.
- Backend chosen per phone at runtime, fastest first: Tensor build on Tensor G5/G6 → GPU → CPU (`src/engine/llm-candidates.ts`). Failures fall through to the next.
- Models are `.litertlm` files from `litert-community/gemma-4-E2B-it-litert-lm`, verified by pinned SHA-256.

## Consequences

The Swift API is "early preview": expect API churn. GGUF files from ADR 3 are replaced by `.litertlm` builds. Text embeddings can use LiteRT-LM's `EmbeddingEngine` too.

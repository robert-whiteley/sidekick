# 2. Expo UI with a native module for always-on work

Date: 2026-11-23 · Status: accepted

## Context

The app needs one UI on iOS and Android, cloud iOS builds from a Linux machine, and continuous audio processing with the screen off.

## Decision

Expo (React Native, new architecture, CNG) for UI and orchestration. Heavy, always-on work (wake word, VAD, STT, speaker embeddings) runs in a local Expo module `modules/sidekick-native` — Kotlin foreground service on Android, Swift on iOS — using sherpa-onnx's official Kotlin/Swift APIs. LLM/VLM via `llama.rn` (superseded by ADR 4: LiteRT-LM).

`react-native-sherpa-onnx` is not used: small project, no keyword spotting / VAD / diarization.

## Consequences

Native code needs development builds (not Expo Go). The sherpa-onnx Android AAR (~52 MB) is downloaded at build time with a SHA-256 check, never committed. iOS needs an sherpa-onnx xcframework.

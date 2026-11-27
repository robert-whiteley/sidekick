# 10. LiteRT-LM 0.20.0 on Android and iPhone

Date: 2026-11-27 · Status: proposed · Builds on ADR 4 and ADR 9

## Context

The chat-model bench (ADR 9, `bench/models/`, Pixel 5, CPU) found that LiteRT-LM 0.20.0 makes
Gemma 4 E2B write about 24% faster than 0.19.1 (8.3 against 6.7 tok/s), with the same blind score
(41/44). But its peak memory was about 0.8 GB higher in that run: 3.11 against 2.27 GB for text,
3.87 against 3.14 GB for photos. The question was whether that comes from the runtime (a bigger
default KV cache, new buffers) or from how the bench was run.

## What the extra memory was

**The bench setup, not the runtime.** The 0.20.0 run built its weights cache from scratch, and
the 0.19.1 run did not:

- The bench measures `VmHWM`, the highest the process ever reached, which never goes down.
- Gemma on 0.19.1 loaded in 2.9 s from a cache built by an earlier run. Gemma on 0.20.0 used a new,
  empty cache folder (`run20.sh`) and took 10 s to load, because it built the cache in that run.
- The gap was already there right after loading (2.45 against 1.50 GB) and stayed about the same
  to the end (3.19 against 2.32 GB). Answering added about 0.8 GB in both runs.
- The same thing shows up on 0.19.1 alone: Qwen3.5-2B used 4.32 GB right after a load that built
  its cache (86 s) and 3.42 GB after a load from that cache (14 s). Building the cache costs about
  0.9 GB at the peak on this phone, whatever the version.

The runtime does not use more memory. Same Gemma file on a PC (x86, CPU, 4 threads, Python
`litert-lm` 0.19.1 and 0.20.0 from PyPI, a fresh process each time, `VmHWM`):

| Run                    | 0.19.1, after load / text / photo | 0.20.0, after load / text / photo | Write speed 0.19.1 → 0.20.0 |
| ---------------------- | --------------------------------- | --------------------------------- | --------------------------- |
| Cache built in the run | 1.51 / 1.59 / 2.11 GB             | 1.37 / 1.45 / 1.95 GB             | 33 → 44 tok/s               |
| Cache already there    | 1.38 / 1.46 / 1.98 GB             | 1.36 / 1.44 / 1.96 GB             | 35 → 42 tok/s               |
| Context 4096 (set)     | 1.38 / 1.46 GB                    | 1.37 / 1.44 GB                    | 34 → 40 tok/s               |
| Context 8192           | 1.50 / 1.57 GB                    | 1.46 / 1.54 GB                    | 22 → 33 tok/s               |
| Context 32768          | 2.15 / 2.22 GB                    | 2.05 / 2.12 GB                    | 7 → 16 tok/s                |

- The default context (KV cache) is the same 4096 tokens in both versions: the default and an
  explicit 4096 give the same memory. 0.20.0 uses slightly less memory at every size.
- The cache format changed: 0.20.0 rewrites a cache that 0.19.1 built (same file name and size,
  different content). So on a phone that already has Sidekick, **the first load after the update
  rebuilds the cache once** (about 10 s instead of 3 s on the Pixel 5, with the ~0.9 GB higher
  peak), exactly as a first install does today. The file is written over in place (same name), so
  it takes no extra space. The memory-search model (EmbeddingGemma) rebuilds its own cache once
  too.

## Decision

Move to LiteRT-LM 0.20.0 on both platforms, with the app's current settings unchanged:

- Context: the model's default (4096 tokens), as now. Photos at 140 image tokens, as now.
- Backends, threads and speculative decoding: as now (fastest available first, CPU fallback).
- Android: `com.google.ai.edge.litertlm:litertlm-android:0.20.0`. It now pulls in Google LiteRT
  2.4.0 (`litert`, `litert-gpu`, `litert-api`, Apache-2.0) for `libLiteRt.so` and its GPU
  accelerator. Native libraries in the APK: 22.7 MB (one) for 0.19.1, 20.2 MB (four) for 0.20.0.
- iPhone: the Swift API in `modules/sidekick-native/ios/LiteRTLM/` is Google's v0.20.0 source,
  unchanged (it adds `ToolChoice.swift`), and the podspec pins `CLiteRTLM.xcframework.zip` from
  the v0.20.0 GitHub release by SHA-256
  `ae6b2b2ea3e46964152110ad5bd64b754f39273add2eb4cc417bbbbd72c5e6e7`. That is the same value as
  Google's `Package.swift` at v0.20.0 and the release's own asset digest, and it matched a fresh
  download.
- No app code changes. The 0.20.0 API changes are all additions: `toolChoice` on `sendMessage`,
  `lenience` on `SpeculativeDecodingConfig`, new GPU/NPU flags. `ThinkingConfig` and the channel
  settings work as in 0.19.1, and 0.20.0 now keeps them for the turn after a tool call too. The
  app uses none of these.
- Low memory: `MemoryWatch.kt` frees the models under Android's memory signals as before, and never
  cuts off an answer being written. The one-off cache rebuild after the update costs no more than a
  first install does now.

## Phone check (not done yet)

The Pixel 5 was on its lock screen when this was made, so nothing was installed. Still to do with
the release APK (`sk-litert20.apk`): the Speed test bench through the deep links
(`src/app/bench.tsx`), twice (the first run rebuilds the cache), with first word, words per second
and peak memory (`dumpsys meminfo`) for text and photo, against 0.19.1. Expected from the above:
faster writing, and peak memory no higher than now once the cache is built.

## Consequences

- About 24% faster writing on the Pixel 5's CPU (bench), with no extra memory once the cache is
  built.
- Qwen3.5-class models now run correctly (ADR 9), should one be worth adding later.
- The first load after the update takes a few seconds longer, once.
- Keep `bench/models/` runs fair: compare runtimes with a warm cache on both sides, or run each
  case in a fresh process.

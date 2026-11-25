# Sidekick's on-phone models vs the cloud models Rewind / Limitless used

Research 25 Nov 2026. Plain summary first, numbers after.

**In short:** on the Pixel 5, Sidekick hears about as well as cloud services in quiet rooms, finds
things in memory as well, and writes short notes and action items well enough. It is **much slower**
(seconds instead of under a second) and **clearly weaker at long, careful reasoning** — summarising a
two-hour meeting, weighing arguments, tricky questions. A 2026 flagship phone runs the same model about
10x faster than the Pixel 5, which removes most of the speed gap but not the intelligence gap.

## What Rewind / Limitless used

- Limitless (pendant + app) sent audio to its servers; a **third-party provider transcribed it**
  (vendor not named publicly; recordings deleted after 30 days). "Ask Limitless" was reported to run on
  **GPT-4-class and Claude models**, routed per task. Reported by secondary sources, not by Limitless.
  ([Sacra](https://sacra.com/c/limitless), [Skywork guide](https://skywork.ai/skypage/en/Rewind-AI-&-Limitless:-The-Ultimate-Guide-to-Your-Digital-Memory/1976181260991655936))
- Meta bought Limitless in Dec 2025; pendant sales stopped; support promised through 2026.

## Speed

|                                              | Time to first word                                    | Writing speed                                               | Source                                      |
| -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| Sidekick, Pixel 5 (Gemma 4 E2B, CPU)         | ≈6 s typed question with memory; ≈30 s photo question | ~5 tokens/s (≈4 words/s — faster than speech, ~2.5 words/s) | measured (ADR 0004/0005)                    |
| Gemma 4 E2B, Galaxy S26 Ultra                | 0.3 s (GPU) / 1.8 s (CPU) for a short prompt          | 52 tok/s GPU, 47 CPU                                        | Google LiteRT-LM table                      |
| Gemma 4 E2B, iPhone 17 Pro                   | 0.3 s (GPU)                                           | 56 tok/s GPU, 25 CPU                                        | Google LiteRT-LM table                      |
| Gemma 4 E2B, Dimensity 9000+ (2022 flagship) | —                                                     | 19 tok/s CPU                                                | third-party test                            |
| Gemma 4 E4B (smarter), S26 Ultra             | 0.8 s GPU                                             | 22 tok/s GPU                                                | Google LiteRT-LM table                      |
| Cloud GPT-4o / GPT-4.1 class                 | ~0.5–1 s plus network                                 | ~50–150 tok/s                                               | typical public measurements; not re-checked |

Pixel 9 / 10 (Tensor G4/G5) and Snapdragon 8 Gen 3 / 8 Elite numbers for Gemma 4 were **not found**;
expect between the Dimensity and S26 figures (~20–45 tok/s). Measure on a real phone.
Source: [LiteRT-LM Gemma 4 page](https://developers.google.com/edge/litert-lm/models/gemma-4),
[Google blog](https://developers.googleblog.com/blazing-fast-on-device-genai-with-litert-lm/).

## Intelligence (published benchmarks, higher is better)

| Benchmark                             | Gemma 4 E2B (Sidekick now) | Gemma 4 E4B | Gemma 3 27B | GPT-4.1 (cloud, 2025) |
| ------------------------------------- | -------------------------- | ----------- | ----------- | --------------------- |
| MMLU-Pro (knowledge + reasoning)      | 60.0%                      | 69.4%       | 67.6%       | 80.5%                 |
| GPQA Diamond (hard science)           | 43.4%                      | 58.6%       | 42.4%       | 66.3%                 |
| LiveCodeBench v6 (coding)             | 44.0%                      | 52.0%       | 29.1%       | —                     |
| Tau2 (using tools / multi-step tasks) | 24.5%                      | 42.2%       | 16.2%       | —                     |
| BigBench Extra Hard                   | 21.9%                      | 33.1%       | 19.3%       | —                     |
| MMMU Pro (images)                     | 44.2%                      | 52.6%       | 49.7%       | —                     |

Gemma numbers: [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4). GPT-4.1:
OpenAI launch post via [R&D World](https://www.rdworldonline.com/openai-claims-gpt-4-1-sets-new-90-standard-in-mmlu-reasoning-benchmark/) and [Vals.ai](https://vals.ai/models/openai_gpt-4.1-2025-04-14).
GPT-4o (what Rewind-era products mostly used) scores below GPT-4.1 on all of these; its exact
GPQA/MMLU-Pro figures were not re-verified this session.

Reading: Sidekick's E2B is roughly at the level of last-generation 27B open models, well below
GPT-4-class models on hard reasoning, and weakest at multi-step tool use (24.5%) — which is why
Sidekick decides actions with rules first and the model second.

## Hearing and memory search

|                              | Sidekick                                            | Cloud                                                            |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Speech-to-text, clean speech | Parakeet TDT 0.6B v2: 2.9% word error (LibriSpeech) | similar (good cloud ASR is ~2–5% on clean speech)                |
| Noisy / far-field speech     | 24% word error on our degraded set                  | cloud is usually noticeably better in noise (not measured by us) |
| Languages                    | English only (today)                                | dozens                                                           |
| Memory search                | EmbeddingGemma, on the phone                        | similar embedding search; no clear advantage either way          |

## Where Sidekick is good enough vs clearly worse (Rewind users' tasks)

| Task                                                                      | Sidekick on Pixel 5                     | On a 2026 flagship                               |
| ------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| "What did Sam say about the invoice?" (search what was said)              | Good enough; a few seconds              | Good enough; ~1 s                                |
| Who was there, short meeting notes, action items (≤ 30 min)               | Good enough                             | Good enough                                      |
| Summary of a 2-hour meeting or a whole day                                | Weaker: misses or merges points; slow   | Weaker than cloud, faster                        |
| Questions needing reasoning across many days ("how has my plan changed?") | Clearly worse                           | Still clearly worse                              |
| Spoken questions in a quiet room                                          | Good enough                             | Good enough                                      |
| Noisy bar / car / far-away speakers                                       | Clearly worse                           | Same (the speech model, not the chip, limits it) |
| Questions about a photo or the camera                                     | Works, slow (~30 s)                     | Works, a few seconds                             |
| Privacy, offline, cost                                                    | Better (nothing leaves the phone, free) | Better                                           |

To narrow the gap later: offer E4B on phones with ≥ 8 GB RAM and a fast GPU (+9 MMLU-Pro points,
+15 GPQA points, ~2x slower than E2B); keep summaries chunked (notes per 10–15 min, then a summary
of the notes) so the small model never has to read hours at once.

# 9. Chat model: keep Gemma 4 E2B (compared with Qwen3.5, Nov 2026)

Date: 2026-11-27 · Status: proposed · Builds on ADR 3 and ADR 4

## Context

The question was whether a newer small model on Hugging Face beats Gemma 4 E2B for Sidekick, given
that conversion is possible. Users get one model, not a picker, so the model has to be good at
everything the app does: chat, memory recall, tool routing, photos, and ideally audio. It also has
to fit 8 GB phones and stay usable on the Pixel 5 (Snapdragon 765G, Adreno 620, 8 GB).

### Survey (Hugging Face, 27 Nov 2026)

Every model below has a ready `.litertlm` build from `litert-community` or Google, so none needs
converting. Scores are the makers' own. Where a model can think, the first number is with thinking
off (how the app runs) and the second with it on.

| Model (size)          | Licence                                                    | MMLU-Pro    | GPQA     | IFEval      | Tool use                     | Multilingual (MMMLU) | Vision / audio                     | LiteRT-LM build                           |
| --------------------- | ---------------------------------------------------------- | ----------- | -------- | ----------- | ---------------------------- | -------------------- | ---------------------------------- | ----------------------------------------- |
| **Gemma 4 E2B** (now) | Apache-2.0                                                 | 60.0        | 43.4     | –           | Tau2 24.5                    | 67.4                 | Image + audio                      | Google's own, 2.59 GB, plus Tensor builds |
| Gemma 4 E4B           | Apache-2.0                                                 | 69.4        | 58.6     | –           | Tau2 42.2                    | 76.6                 | Image + audio                      | Google's own, 3.66 GB; already in catalog |
| Qwen3.5-2B            | Apache-2.0                                                 | 55.3 / 66.5 | – / 51.6 | 61.2 / 78.6 | BFCL-v4 43.6, Tau2 48.8 (on) | 56.9 / 63.1          | Image; no audio                    | Text 2.12 GB; vision 3.15 GB (int8)       |
| Qwen3.5-4B            | Apache-2.0                                                 | 79.1 (on)   | 76.2     | 89.8        | BFCL-v4 50.3, Tau2 79.9 (on) | 76.1                 | Image upstream; build is text only | Mixed int4 2.75 GB, int8 4.42 GB          |
| Granite 4.2 3B        | Apache-2.0                                                 | 67.8        | 54.8     | –           | BFCL-v4 52.4                 | –                    | Text only                          | int4 2.19 GB                              |
| Ministral 3 3B        | Apache-2.0                                                 | –           | 53.4     | –           | –                            | 65.2                 | Image upstream; build is text only | q4 2.34 GB                                |
| SmolLM3 3B            | Apache-2.0                                                 | –           | 41.7     | 76.7        | BFCL-v3 92.3                 | Global MMLU 64.1     | Text only                          | q4 2.0 GB                                 |
| Phi-4-mini 3.8B       | MIT                                                        | –           | –        | –           | –                            | –                    | Text only                          | q8 3.9 GB, 4k context                     |
| MiniCPM-V 4.7 1B      | Apache-2.0                                                 | –           | –        | –           | –                            | –                    | Image                              | Vision int8 2.2 GB                        |
| Nemotron 3 Nano 4B    | NVIDIA Open Model Licence (commercial, no cap; use terms)  | –           | –        | –           | –                            | –                    | Text only                          | int8 4.1 GB                               |
| LFM3 1.7B / LFM3-VL   | LFM Open License: **free only under $10M revenue**         | –           | –        | –           | –                            | –                    | Image / audio variants             | Yes; **rejected on licence** (as ADR 3)   |
| Llama 3.2 1B / 3B     | Llama Community: **700M-MAU cap**, use policy, attribution | –           | –        | –           | –                            | –                    | Text only                          | Yes; **rejected on licence**              |

Only Gemma has audio. The text-only models (Granite, Ministral's build, SmolLM3, Phi, Nemotron,
Qwen 4B's build) would need a second model for photos, which goes against the one-model choice.
On an 8 GB phone, anything over about 3 GB on disk leaves too little memory once the app, speech
models and the weights cache are counted. That left two to test:

- **Qwen3.5-2B with vision**: the same jobs as Gemma (no audio), and better scores on paper with
  thinking on.
- **Qwen3.5-4B mixed int4**: the strongest on paper that still fits, text only.

### Method

`bench/models/` runs LiteRT-LM's Android library from the command line on the Pixel 5, the way
`LlmEngine.kt` does: one engine, a fresh conversation per question, the app's own system prompt,
memory notes, date line, and tool-router prompt. 22 made-up prompts: memory recall (6), tool
routing (6), plain questions (7), photos (3). All on CPU: the Qwen card says its GPU build doesn't
fit an 8 GB Pixel 8a, and that on low-end Android GPUs decoding is no faster than the CPU.
Answers were shuffled and scored 0–2 by a separate agent that didn't know which model wrote which.

## Results (Pixel 5, CPU)

| Run                         | Load                  | First word, median (memory / tool / plain / photo) | Answer done, median    | Write speed           | Peak memory (text / photo) | Blind score |
| --------------------------- | --------------------- | -------------------------------------------------- | ---------------------- | --------------------- | -------------------------- | ----------- |
| **Gemma E2B, 0.19.1** (now) | 2.9 s                 | 4.9 / 4.5 / 3.1 / 19.3 s                           | 7.6 / 7.6 / 5.7 / 22 s | 6.7 tok/s, 4.2 word/s | 2.27 / 3.14 GB             | **41/44**   |
| Gemma E2B, LiteRT-LM 0.20.0 | 10 s (new cache)      | 4.7 / 4.8 / 3.6 / 22.1 s                           | 6.5 / 8.6 / 5.6 / 24 s | 8.3 tok/s, 5.1 word/s | 3.11 / 3.87 GB             | 41/44       |
| Qwen3.5-2B vision, 0.20.0   | 86 s first, then 14 s | 7.8 / 6.8 / 5.5 / 34.8 s                           | 12 / 11 / 9 / 38 s     | 4.8 tok/s, 3.0 word/s | 4.24 / 4.58 GB             | 38/44       |
| Qwen3.5-4B int4, 0.20.0     | 45 s                  | 27 / 24 / 17 s (no photos)                         | 35 / 31 / 27 s         | 2.7 tok/s, 1.7 word/s | 4.5 GB                     | 33/38       |
| Qwen3.5-2B vision, 0.19.1   | –                     | –                                                  | –                      | 4.8 tok/s             | 4.3–4.7 GB                 | 21/44       |

Blind scores by kind (2 points per prompt):

| Run             | Memory | Tool  | Plain | Photo | Total |
| --------------- | ------ | ----- | ----- | ----- | ----- |
| Gemma, 0.19.1   | 12/12  | 10/12 | 13/14 | 6/6   | 41/44 |
| Gemma, 0.20.0   | 12/12  | 9/12  | 14/14 | 6/6   | 41/44 |
| Qwen 2B, 0.20.0 | 10/12  | 9/12  | 13/14 | 6/6   | 38/44 |
| Qwen 4B, 0.20.0 | 9/12   | 11/12 | 13/14 | –     | 33/38 |
| Qwen 2B, 0.19.1 | 10/12  | 0/12  | 7/14  | 4/6   | 21/44 |

- Gemma's misses: both runs chose `camera` instead of `camera_setting` for "set the camera to 60
  fps"; one half-right reminder (0.20) and one half-right date question (0.19.1).
- Qwen 2B: sent "message Tom" to a 10-minute timer, set a 6:30 alarm for 10:30, and mixed up Tom
  and Sam in a memory question.
- Qwen 4B: routed tools best, but got an alarm time wrong, talked about "your notes", and took
  21–92 s per answer.
- Space on the phone, model plus weights cache: Qwen 2B vision about 3.15 + 2.8 GB; Gemma about
  2.6 + 1.0 GB.
- **Qwen 2B on LiteRT-LM 0.19.1 (the version the app ships) is broken on the Pixel 5**: it repeats
  the prompt and writes nonsense. The chat template renders correctly, changing the sampler makes
  it worse, and the same file is fine on 0.20.0 on the phone and on a PC. So the cause is the
  runtime: Qwen3.5's hybrid layers need 0.20.

## Decision

Keep Gemma 4 E2B as the one chat model. Nothing on Hugging Face beats it overall on the phones
Sidekick targets:

- Qwen3.5-2B is about 30% slower to write, takes about 35 s rather than 20 s for photos, needs 1–2
  GB more memory and twice the weights cache, has no audio, needs LiteRT-LM 0.20, and scored
  slightly lower here.
- Qwen3.5-4B is smarter on paper and the best at tool routing, but at 20–90 s per answer it is far
  too slow on a Pixel 5 and has no vision in its LiteRT build.
- The licence-clean text-only models would need a second model for photos.

Gemma 4 E4B (already in the catalog for 12 GB phones) stays the step up where memory allows.

## Consequences

- No model change.
- Separate finding: **LiteRT-LM 0.20.0 makes Gemma write about 24% faster on the Pixel 5** (8.3 vs
  6.7 tok/s), with the same scores, but peak memory was about 0.8 GB higher in this run. Worth its
  own change, after checking memory in the app and on the first cache build.
- Look again when Qwen3.5-class models get audio, a GPU build that fits 8 GB, or the app's minimum
  phone moves past the Pixel 5. Rerun `bench/models/` with the new file.

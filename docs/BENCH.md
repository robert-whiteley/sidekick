# Benchmarks

How well Sidekick does on made-up test data, measured offline with the app's own models and logic.
Tools and how to rerun: [bench/README.md](../bench/README.md).

## Voices and transcription (26 Nov 2026)

**What is measured.** Eight made-up scenes with 2–4 people (book club, flat, meeting, neighbours, café,
football club, family, studio). Each scene has a first conversation and a later one with the same
people. The owner ("You") is in every scene and asks four wake-word questions. 21 people, 16
conversations, about 13 minutes of speech. TTS voices (Kokoro, Piper LibriTTS-R), with realistic
turn gaps (10% overlap, 35% shorter than 0.6 s). Mixed with crowd babble, pink noise and street noise
at 20/10/5/0 dB (signal-to-noise; 0 dB means the noise is as loud as the speech), all with room echo.

The pipeline is the app's: Silero VAD → Parakeet (words) → CAM++ (voiceprint) → `src/memory`
voice matching and names, replayed line by line with one speaker list across all conversations.

| Measure      | Meaning                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| Right person | Share of speech time given to the right person within each conversation            |
| Across talks | Same, but one label must mean the same person in every conversation                |
| You found    | Share of the owner's speech labelled "You"                                         |
| You wrong    | Share of other people's speech labelled "You"                                      |
| Again later  | People recognised in their second conversation as the same voice as in their first |
| Named        | People who got their right name automatically                                      |
| Mixed lines  | Share of line time where one line holds more than one person (purity < 80%)        |
| WER          | Word error rate (lower is better)                                                  |

### Root cause found

Lines held 2–4 people. The app cut a line only after 0.6 s of silence, but people in conversation
answer faster than that, and café babble keeps the speech detector on for the full 25 s limit. A
mixed line gets one voiceprint, so it is given to one person, the voiceprint learned from it is
smeared, names land on the wrong voice, and the owner's lines vanish into other people's.

**Fix (in `LineSplit.kt`, `MicLoop.kt`):** every finished line of 2 s or more that isn't a question
to Sidekick is split at pauses of 0.25 s or more, and long stretches without a pause are judged in 2 s
blocks cut at the quietest moment. Each piece of 1 s or more gets a voiceprint, and the line is cut
where the voice changes (similarity below 0.4). The words come from one transcription of the whole
line, shared out to the parts by each word's time, so transcription is unchanged. Extra cost: one
voiceprint per piece, only on lines of 2 s or more.

Also fixed: "Sam, can you…" waited for the reply before naming who answered, but live lines arrive
one at a time, so the reply was never seen. The cue now waits up to 10 s for the answer. New intro
cues: "hi there/hiya all, I'm X", "I'm X, by the way", "and I'm X".

### Results: before → after

| Condition | Right person | Across talks | You found | You wrong | Again later | Named     | Mixed lines | WER   |
| --------- | ------------ | ------------ | --------- | --------- | ----------- | --------- | ----------- | ----- |
| clean     | 69% → 93%    | 59% → 80%    | 71% → 97% | 11% → 1%  | 48% → 76%   | 30% → 45% | 56% → 8%    | 3.4%  |
| room echo | 67% → 93%    | 57% → 81%    | 71% → 98% | 11% → 1%  | 48% → 71%   | 20% → 45% | 55% → 7%    | 4.3%  |
| babble 20 | 59% → 91%    | 44% → 77%    | 49% → 94% | 5% → 1%   | 24% → 76%   | 15% → 45% | 66% → 11%   | 2.7%  |
| babble 10 | 38% → 76%    | 25% → 66%    | 3% → 85%  | 1% → 1%   | 0% → 67%    | 0% → 25%  | 97% → 16%   | 7.1%  |
| babble 5  | 31% → 64%    | 22% → 58%    | 71% → 78% | 62% → 2%  | 8% → 38%    | 0% → 15%  | 98% → 19%   | 33.5% |
| babble 0  | 25% → 49%    | 25% → 37%    | 100%→ 17% | 100% → 2% | 0% → 18%    | 0% → 0%   | 99% → 28%   | 83.1% |
| pink 20   | 67% → 92%    | 64% → 84%    | 79% → 98% | 15% → 1%  | 57% → 81%   | 20% → 50% | 55% → 9%    | 4.3%  |
| pink 10   | 63% → 87%    | 59% → 81%    | 77% → 97% | 14% → 0%  | 43% → 86%   | 25% → 40% | 56% → 10%   | 5.4%  |
| pink 5    | 65% → 84%    | 62% → 82%    | 67% → 94% | 9% → 2%   | 52% → 86%   | 25% → 40% | 53% → 10%   | 12.8% |
| pink 0    | 63% → 77%    | 58% → 73%    | 80% → 92% | 13% → 5%  | 38% → 57%   | 10% → 15% | 49% → 14%   | 37.3% |
| street 20 | 67% → 93%    | 58% → 83%    | 64% → 98% | 9% → 1%   | 52% → 76%   | 20% → 50% | 56% → 10%   | 4.3%  |
| street 10 | 65% → 90%    | 62% → 83%    | 81% → 98% | 17% → 1%  | 48% → 81%   | 20% → 45% | 57% → 10%   | 2.9%  |
| street 5  | 66% → 87%    | 60% → 77%    | 75% → 96% | 12% → 1%  | 38% → 71%   | 20% → 40% | 55% → 12%   | 4.8%  |
| street 0  | 65% → 82%    | 62% → 78%    | 74% → 92% | 7% → 2%   | 70% → 86%   | 15% → 40% | 46% → 9%    | 18.8% |

WER is the same before and after in every condition. In babble 5 and 0 the "before" owner numbers
are high only because almost everything was one long line given to "You".

### On the phone (Pixel 5, laptop speaker at about 1 m)

Three dialogues played out loud with Listen on (clean flat, clean football club, café in babble at
10 dB), first on the current build, then on the test build. Turns given to the right person, counted
by hand against the script:

| Dialogue      | Before                                | After                                                           |
| ------------- | ------------------------------------- | --------------------------------------------------------------- |
| Flat (clean)  | 8/12; first two lines held 3–4 people | 9/12; Ines and Okello right; Ruth merged with the owner's voice |
| Club (clean)  | 4/11; one line held 5 turns           | 9/11; Callum, Femi, Nadia apart and named                       |
| Café (babble) | 4/11; two 25 s lines, all "Waiter"    | 8/11; Zofia and the owner right; the waiter mostly "Someone"    |
| Total         | 16/34                                 | 26/34                                                           |

The line cut fired 7 times in about 3 minutes ("line cut in 2–9 where the voice changes"), with no
errors or slowdowns seen. The wake word and push-to-talk were not used, so the owner's voice was not
touched.

### Descriptions (people with no name)

Unnamed people should show a role from what they say ("Waiter", "Bus driver"). The bench now scores
this: every made-up person has a role, four are never named (waiter, bus driver, shop assistant,
doctor), and a person counts as **shown right** when the voice that is mostly them shows their name
or their role at the end of each conversation. Offline, only the role phrases run; the model's
reading of the conversation runs on the phone only.

**Why the waiter became "Someone":** after the line cut, many turns are shorter than 2.5 s. A new
voice needed one piece at least 2.5 s long, so a person who only says short things ("Can I get you
any drinks?") never got a voice; their lines stayed "Someone", and descriptions are only given to
voices. **Fix:** short pieces that sound alike (similarity ≥ 0.5, within a minute) now add up: once
they total 2.5 s they become a new person, and the earlier "Someone" lines move to them. Role phrases
also accept the shorter wording speech-to-text produces ("You need a bag?", "a few more minutes").

Shown right, everyone / unnamed only (25 people, 11 scenes), before the line cut → after it (PR 21)
→ with this fix:

| Condition | Shown right (all) | Unnamed shown by role | "Someone" (other people) |
| --------- | ----------------- | --------------------- | ------------------------ |
| clean     | 26% → 50% → 52%   | 50% → 75% → 88%       | 2% → 1% → 1%             |
| reverb    | 32% → 52% → 54%   | 75% → 88% → 100%      | 2% → 2% → 2%             |
| babble 20 | 32% → 56% → 58%   | 75% → 88% → 100%      | 1% → 2% → 2%             |
| babble 10 | 6% → 34% → 36%    | 25% → 88% → 100%      | 0% → 21% → 17%           |
| babble 5  | 0% → 6% → 8%      | 0% → 13% → 25%        | 0% → 39% → 39%           |
| pink 20   | 24% → 54% → 56%   | 63% → 88% → 100%      | 1% → 1% → 1%             |
| pink 10   | 30% → 48% → 50%   | 75% → 88% → 100%      | 1% → 3% → 3%             |
| pink 5    | 22% → 28% → 28%   | 50% → 63% → 63%       | 3% → 4% → 4%             |
| pink 0    | 6% → 14% → 16%    | 13% → 13% → 25%       | 3% → 7% → 7%             |
| street 20 | 32% → 56% → 58%   | 75% → 88% → 100%      | 1% → 1% → 1%             |
| street 10 | 24% → 60% → 62%   | 63% → 88% → 100%      | 2% → 2% → 2%             |
| street 5  | 20% → 38% → 40%   | 63% → 88% → 100%      | 2% → 1% → 1%             |
| street 0  | 22% → 22% → 22%   | 38% → 38% → 38%       | 3% → 9% → 9%             |

The fix changes no other number except in babble 10 and 5 (babble 10: turns right per conversation
72% → 75%, "Someone" 21% → 17%, one more split). Thresholds tried for "sound alike": 0.5 is best;
0.55 kept more "Someone" (20%), 0.6 and above did nothing.

**Phone check: not done.** The phone was locked behind its PIN when this ran, so the café, bus and
shop clips were not played; the fix is checked offline and by tests only.

### Still weak

- **A person split into two voices** can lose their role: in the clean café the waiter's first
  conversation splits, and the larger part has no waiter phrases, so it shows "Person N".
- **Similar voices merge across conversations** (4–5 merges out of 21 people, mostly between scenes).
  Raising the same-voice threshold to 0.6 helped clean audio a little but hurt echo; not changed.
- **Speech-to-text mishears unusual names** (Okello → Okolo, Tomasz → Thanas, Wren → Ren), so the
  right person gets a slightly wrong name. 34 of 50 spoken names are heard right in clean audio.
- **Loud babble (5 dB and below):** words fall apart (WER 34–83%) and many short pieces stay
  "Someone" (32–41% of other people's speech).
- **Pink noise at 0 dB** splits people into too many voices (35 voices for 21 people).
- **Overlapping speech** still lands in one line.
- Synthetic voices and noise only; real rooms and real voices will differ. The phone test used a
  laptop speaker, which makes voices sound more alike than in person.

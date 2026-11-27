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

## Answers, routing and recall (26 Nov 2026)

**What is measured.** 143 fixed requests (`bench/answers/cases.ts`): general knowledge 15,
arithmetic 12, dates 14, units 8, short reasoning 8, every tool and command 63 (timers, alarms,
reminders, to-dos, routines incl. one-offs, camera settings, speech speed, torch, volume,
listening, navigation, memory, notes, recap, steps/battery/storage, weather, online lookup,
message/call/email/calendar drafts, location, watching), near-misses that must not start a tool
14 ("tell me about timers", "write a poem", "I love the camera on this phone"), refusals 5
("text me a fun fact") and multi-step 4. Each case says which rule or tool is right (with key
arguments) and, where checkable, words the answer must or must not contain. On the phone the
router only picks; nothing is run, sent or saved.

Recall (`bench/recall/generate.ts`): 37 invented facts in about 5 weeks of made-up conversation
notes, notes and photo captions (Priya and the boiler, Westgate car park level 4, the book club),
filler up to any size, and 50 questions with the expected answer words.

Pixel 5, CPU, Gemma via LiteRT-LM. "Before" is main with the bench added; "after" is this branch.

### Root causes found

- **Any instruction-shaped sentence offered the model all ~30 tools.** "Tell me a joke", "Write a
  short poem", "Give me three tips", "Explain how GPS works" and word puzzles ("Tom is taller than
  Sam… Who is the shortest?") waited 16–22 s for the tool router, which then searched memory
  instead of answering. Questions with an action word in them ("What language do people **speak**
  in Brazil?", "How many **minutes** are in 3 hours?") were offered speech speed or timers. Now a
  question (its last sentence, after any "If …,") is never offered action tools, and jokes, poems,
  tips, explanations, look-ups and remarks go straight to the answer.
- **The model doesn't know today's date** and gets calendar facts wrong ("A leap year has
  thirty-six days", "2028 is not a leap year", "I do not have access to the current date"). Date
  questions are now worked out in code (`src/integrations/date-answers.ts`: today, tomorrow, leap
  years, days in a month, days until/since a date or holiday, the weekday of a date), and any
  answer prompt about dates or time gets today's date and time.
- **"Text me a fun fact" drafted a text to a contact called "me".** Messages, emails and calls to
  me/myself are now never drafted; the model answers instead.
- **Rules missing for plain phrasings**, so they waited ~5–7 s for the router (and twice got
  the arguments wrong): "Lower the frame rate", "Use the selfie camera", "Start a countdown of
  90 seconds", "Add bread to my to-do list", "Don't let me forget to buy milk".
- **"Every Monday at 8 tell me the weather" answered today's weather** instead of setting up the
  routine.
- **Memory questions caught by other rules:** "Where did I leave my umbrella?" (weather), "How
  much does Wen's plumber charge?" (battery), "What did I buy Kofi for his birthday?" (contacts'
  birthdays), "Until when is…" (all tools), "What did I talk about with Hamid?" (a recap about
  "with hamid"). "Where did I park?" / "Where was I on Tuesday?" with nothing in location history
  now answer from memory notes when they say, else give the old reason.
- "Half of 87", "How many pounds is 2 kg?", "How many millilitres are in 2.5 litres?" now
  calculated in code (the model wrote the right answer, in words).

### Results: before → after

| Set (cases)      | Right rule/tool, phone | Answers right, phone | Offline rules (any PC) |
| ---------------- | ---------------------- | -------------------- | ---------------------- |
| Knowledge (15)   | 13 → 15                | 13/13 → 15/15        | 13 → 15                |
| Arithmetic (12)  | 11 → 12                | 10/11 → 11/12        | 9 → 12                 |
| Dates (14)       | 14 → 14                | **5/14 → 14/14**     | 14 → 14                |
| Units (8)        | 8 → 8                  | 6/8 → 6/8            | 8 → 8                  |
| Reasoning (8)    | 4 → 8                  | 4/4 → 8/8            | 3 → 8                  |
| Tools (63)       | 59 → 63                |                      | 49 → 61 (+2 for model) |
| Near-misses (14) | 9 → 14                 |                      | 6 → 13 (+1 for model)  |
| Refusals (5)     | 3 → 5                  | 1/1 → 2/2            | 1 → 4 (+1 for model)   |
| Multi-step (4)   | 4 → 4                  |                      | 4 → 4                  |
| **All (143)**    | **125 → 143**          | **40/52 → 57/60**    | **107 → 139**          |

The three answers still marked wrong after (half of 87, 2 kg in pounds, 2.5 l in ml) were right
in words; they are now calculated in code (offline: 32/32 code answers right; not re-run on the
phone).

| Speed (phone)                             | Before                              | After         |
| ----------------------------------------- | ----------------------------------- | ------------- |
| Tool-router calls across the 143          | 34, 326 s total                     | 4, 24 s total |
| Router waits over 12 s                    | 9                                   | 0             |
| "Tell me a joke": first words             | none (17.5 s, then a memory search) | 3.5 s         |
| Word puzzle (bat and ball): first words   | 19.5 s                              | 3.2 s         |
| "Lower the frame rate"                    | 6.9 s                               | instant       |
| Model answers: median first words / total | 3.2 s / 6.1 s                       | 3.2 s / 5.6 s |

### Recall (phone, after)

100 test memories added next to the phone's own (about 1,300 in all; only counts of the phone's
own memories were read, never their content):

| Measure                                         | Result                    |
| ----------------------------------------------- | ------------------------- |
| Right memory ranked first by search             | 49/50                     |
| Right memory in the top 4 (what the model sees) | 50/50                     |
| Search time (about 1,300 memories)              | median 0.35 s, max 0.43 s |
| Full answer right                               | 44/50                     |
| Answer: median first words / total              | 3.9 s / 7.1 s             |
| Adding 100 memories (with vectors)              | 31 s                      |

Of the 6 misses: "What did I talk about with Hamid?" became a recap about "with hamid" (fixed,
not re-run on the phone); "Where did I park?" answered from the phone's real parking spot, which
is right; 4 had some of the owner's memories in the notes the model saw, so their text was not
logged and why they missed is unknown (the bench now logs which test notes were seen and whether
the answer said it didn't know, without the text). Test memories were removed afterwards: the
owner's counts of memories, facts and voices were the same before, during and after; test rows 0.

### Still weak / not measured

- **Search time at 1,000 and 5,000 extra memories** (measured 26 Nov evening, Pixel 5, on top of
  the owner's 1,228):

  | Test memories | Load (with vectors)                | Search median / p90 / max | Right memory in top 4 |
  | ------------- | ---------------------------------- | ------------------------- | --------------------- |
  | 1,000         | 277 s, +1.4 MB                     | 0.30 / 0.34 / 0.56 s      | 50/50                 |
  | 5,000         | 310 s (1,037 new vectors), +5.5 MB | 0.35 / 0.40 / 0.70 s      | 50/50                 |

  Search hardly slows down from 2,200 to 6,200 memories. The owner's counts (1,228 memories,
  8 facts, 23 voices) were the same before, during and after; test rows 0 afterwards; the deep-link
  flag file was deleted. **Storage is not given back:** after the 5,000 were removed the database
  still used 8.6 MB against 3.1 MB before (being looked into).

- Units: the model writes numbers in words ("four and four-tenths pounds"); fine to hear, but not
  checkable by rule.
- 4 requests still go to the model router on purpose (an unusual phrasing like "give me a shout
  in a quarter of an hour", "make it grab fewer pictures", "The alarm went off too early").
- Answers with the owner's own memories in the prompt can't be scored without reading them.

## Limits, robustness and battery (26 Nov 2026)

**How.** The installed app on the Pixel 5 (CPU only, 8 GB), driven over adb by `bench/limits/`
with made-up questions: time per answer, app memory (PSS), app CPU time, battery and temperature
after every turn. Each tap and typed key first checks that Sidekick is the app in front.
"Before" is the store build sk62; "after" is this branch.

### Long chats: the chat broke after about 25 turns (fixed)

| Same chat, 2 s between questions  | Before (sk62)                               | After                             |
| --------------------------------- | ------------------------------------------- | --------------------------------- |
| Turns answered                    | 27 of 35 (failures from turn ~25 on)        | 29 of 29                          |
| Failures after ~2,900 chat tokens | 8 of 11 turns ("Something went wrong")      | 0 (a fresh model chat at ~2,926)  |
| Background summary of the chat    | cancelled 3 of 3 times by the next question | still cancelled; no longer needed |
| Time per answer                   | 5.1–8.6 s                                   | 5.2–8.9 s (one 15.5 s)            |
| App memory (PSS)                  | 3.26–3.43 GB, flat                          | 2.55–3.14 GB, flat                |
| Battery temperature (on USB)      | 31.7–32.6 °C                                | 31.5–32.4 °C                      |

- **Root cause.** The chat with the model only grows until a background summary shrinks it, and
  that summary is cancelled by every new question, so in a steady chat it never finishes. At about
  2,900 tokens of history plus the question, the model's 4,096-token window is full. LiteRT-LM
  reports that only as "Task failed with state: 7" (the prefill failed), which the app showed as
  an error. Short tool answers (sums, conversions) kept working because they skip the chat.
- **Fix.** Before each question, if history + question + room for the answer would pass 3,400
  tokens, the model starts a fresh chat (the app's own history and summary stay). If the model
  still says it is full (any of its three wordings, including state 5 and 7), the question is asked
  again once in a fresh chat. The summary reads at most the newest 6,000 characters of older turns,
  so it stays short enough to finish. Unit-tested (`conversation-test.ts`).
- **Very long typed or pasted questions** are cut to 9,000 characters (start and end kept, with a
  note in the middle) so they can't overflow the window on their own.
- Memory and speed don't degrade over the session; CPU time per turn stays the same.
- The "first word" time the app logs (`ttft`) repeats the same value every turn: it comes from
  LiteRT's benchmark counter, which isn't reset per answer. Not used here.

### A plain request opened the browser while Offline (fixed)

"Give me a quick recipe for pancakes" (Offline on) was routed to the web-search tool, and Chrome
opened with a DuckDuckGo search. An instruction with no tool word in it was offered all 30 tools,
and Gemma picked one. That also cost ~15 s of routing on such turns.

- Requests for words ("give me…", "write…", "list…", "translate…", "suggest…") now get no tools and
  go straight to the answer. Vague instructions ("sort out the thing for Jo") still see every tool.
- With Offline on (lookup off or no internet), a web search is never opened by itself. The reply
  says Sidekick is offline and shows "Search the web in your browser", which opens only on a tap.
  This also applies to a named app that isn't installed (it would fall back to the browser) and
  to Uber's web page. Installed apps the user names still open (ADR 0006).
- Tests: `tools-router-test.ts`, `offline-handoff-test.ts`.

Everything that can open another app or the web:

| What                                            | Opens                       | Offline                                    |
| ----------------------------------------------- | --------------------------- | ------------------------------------------ |
| Search ("search YouTube / Amazon / Maps for …") | That app                    | Opens (the user named it)                  |
| Search the web / Google                         | Browser                     | Waits for a tap on the link (new)          |
| Search a named app that isn't installed         | Browser                     | Waits for a tap on the link (new)          |
| Rides (Uber, Bolt, Lyft, FREENOW)               | Ride app                    | Opens; Uber's web page doesn't (new)       |
| Navigate, play music/video, open an app         | Maps / music app / that app | Opens (the user named it)                  |
| Messages, calls, email                          | A card first; app on Send   | As before: the other app queues (ADR 0008) |
| Feedback email with sending off                 | Mail app with a draft       | Opens; the user presses Send there         |
| QR/barcode "Open" button                        | Browser / dialer / mail     | Only on the user's tap                     |
| "Search the web in your browser", source links  | Browser                     | Only on the user's tap                     |

### Checked on the phone (test build of this branch, 26 Nov evening)

| Test                                                | Result                                                  |
| --------------------------------------------------- | ------------------------------------------------------- |
| "Give me a quick recipe for pancakes" (Offline)     | Answered in Sidekick, 9.6 s; nothing else opened        |
| "Search the web for pancake recipes" (Offline)      | The offline reply and the browser link; nothing opened  |
| Typed question of 4,000 characters                  | Answered, 15 s                                          |
| Typed question of 12,000 characters                 | Answered, 21 s (cut to 9,000 for the model)             |
| App killed mid-answer, then opened again            | Back in 7 s; next answer fine; that question is lost    |
| App killed while the model loads, then opened again | Opens normally; next answer fine                        |
| Home pressed mid-answer, back after 20 s            | The answer had finished and was shown                   |
| Café dialogue played aloud with Listen on (main)    | Labelled "Customer" and "Waiter"; Live notes named both |

App memory after these: 3.1 GB PSS (native heap 1.5 GB, model files mapped 1.5 GB).

### Heard lines could be lost (fixed)

The background service writes heard lines to a journal file that the app moves into the
encrypted database. The app used to empty the file first and then save, so a failed save (full
storage, a crash, the app killed mid-way) lost those lines. Now lines stay in the file until they
are saved. A batch is retried up to 3 times; lines already saved are skipped on replay.
Unit-tested in Kotlin (`JournalTest.kt`) and JS (`journal-take-test.ts`).

Also bounded: short unattributed voice clips waiting for their speaker are dropped after 60 s
(they piled up during long Listen sessions), and only the streaming chat bubble re-renders while
an answer is written.

### Still weak / not yet measured

- Battery drain per hour per mode, thermal over 30+ min of Live camera, and captions holding back
  on a charger that can't keep up: need the phone (a 2 h unplugged run is planned).
- Not yet run on the phone: low memory with Live + Listen + questions, rotation with the camera on.
- ~~When space is short only video stops~~, ~~no reaction to Android's low-memory signal~~ and
  ~~a voiceprint stored for voices that haven't consented~~: fixed, see "Robustness fixes" below.

### Robustness fixes (26 Nov 2026)

Built and unit-tested (JS and Kotlin), voice bench re-run offline. **Not checked on the phone:** the
shared-phone scripts (`scripts/phone-lock.sh`, `scripts/phone-input.sh`) are not on `main` yet, so
the phone was not used.

**Voices that haven't agreed were stored (SPEC 4).** In consent mode every new voice got a
`speakers` row with its voiceprint before the consent check, even when none of its lines was kept.
Now a voice is written only together with a kept line of theirs. Until then it lives in memory for
the conversation (negative id, its own "Person N" on screen, learned in memory, forgotten after 10
minutes unheard or when the app closes), so lines are still told apart live; when that voice says
yes it is stored under the same label. Lines that aren't kept no longer teach a stored voiceprint.
On start, in consent mode, stored voices that never agreed and have no kept line are removed (a
person the user named or wrote notes about keeps the page, without the voiceprint). Tests:
`robustness-fixes-test.ts` (consent rule, in-memory voices, transcript relabel).

**One person's lines on two people.** Cause: a voice that has just started has a centroid from 1–3
clips, so its own person's next lines score lower against it (often under the 0.55 same-voice
line) than against an older, well-learned voice that sounds alike, or they start yet another
voice. The match took the single highest score and ignored the conversation going on. That is the
café finding (the waiter's lines going to a voice from an earlier test at 0.55–0.76) and the
offline café split (the waiter as two voices, so the part with "Ready to order?" was not the one
shown). Fix: a voice with at most 3 clips heard in the last 10 minutes is joined from 0.45 and
wins over an older voice unless that one scores 0.1 more; never for the owner.

Voice bench (same data as above, line-cut pipeline), before → after:

| Condition | Right person | Across talks | "Someone" | People split | Again later | Shown right |
| --------- | ------------ | ------------ | --------- | ------------ | ----------- | ----------- |
| clean     | 93%          | 83% → 81%    | 1%        | 1 → 0        | 80% → 76%   | 52% → 54%   |
| reverb    | 91%          | 82%          | 2%        | 0            | 80%         | 54%         |
| babble 20 | 90%          | 83%          | 2%        | 0            | 80%         | 58%         |
| babble 10 | 75% → 77%    | 65% → 68%    | 17% → 15% | 3            | 56% → 60%   | 36%         |
| babble 5  | 54% → 58%    | 46% → 50%    | 39% → 35% | 9            | 48%         | 8%          |
| pink 20   | 92% → 93%    | 84% → 85%    | 1%        | 1 → 0        | 80%         | 56%         |
| pink 10   | 89% → 90%    | 84% → 86%    | 3%        | 5 → 2        | 84%         | 50%         |
| pink 5    | 86% → 88%    | 85% → 86%    | 4% → 3%   | 7 → 3        | 88% → 84%   | 28% → 36%   |
| pink 0    | 78% → 80%    | 72% → 74%    | 7% → 6%   | 15 → 12      | 64%         | 16% → 20%   |
| street 20 | 93%          | 83%          | 1%        | 0            | 80%         | 58%         |
| street 10 | 91% → 92%    | 83% → 85%    | 2%        | 3 → 0        | 84%         | 62%         |
| street 5  | 90% → 91%    | 79% → 80%    | 1%        | 4 → 1        | 72% → 76%   | 40%         |
| street 0  | 80% → 85%    | 75% → 77%    | 9% → 8%   | 14 → 9       | 60% → 64%   | 22%         |

Averaged over the 13 conditions: right person 84.8% → 86.2%, across talks 77.2% → 78.5%, again
later 73.5% → 73.8%, "Someone" 6.8% → 6.2%, people split 62 → 39, unnamed shown by role 80% → 84%;
"You" found and "You" wrong unchanged. The one drop: in clean audio the café waiter is now one
voice, and the footballer Femi (next scene, a similar TTS voice) then merges into it across
scenes (across talks 83% → 81%, again later 80% → 76%); that is the known cross-conversation merge,
not a split. Tried: 0.5 or 0.55 instead of 0.45 (fewer splits fixed), 0.4 (babble 5 again-later
48% → 44%), any recent voice instead of young ones only (more cross-scene merges), margin 0–0.15
(no difference). Rerun: `node bench/voice/score.mjs DATA [--no-recent] COND…` (`--no-recent` = before).

**No reaction to low memory.** Android's memory signals now free the big models (`MemoryWatch.kt`,
for the app and the listen service): running-moderate/low trim levels and the low-memory flag
(checked every 30 s while both are loaded) unload the embedder; running-critical, the background
levels and `onLowMemory` unload both, the chat model only while it isn't answering. OCR goes too,
and JS drops its place-name pack. All reload on demand; a question that arrives just after an
unload loads the model again and is asked once more. iPhone: a memory warning frees the embedder
and the idle chat model. Tests: `RobustnessTest.kt` (levels, what is freed), `jsPlan`.

**Only video stopped when space was short.** Now one rule on both sides
(`storage-guard.ts`, `StorageGuard.kt`):

| Free space                                  | Paused                                                                                      | Still saved                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| Under the reserve (Settings → Storage)      | Video, full-size camera stills, conversation audio; downloads that would go under it        | Words heard, photos taken, keyframes |
| Under 500 MB or 1% of the phone (≤ reserve) | Also photos ("Phone storage is full… free up space"), keyframes, downloads, vectors, memory | Heard lines wait in the journal file |

Stopping at the floor, well before the disk is full, keeps room for the database's own writes, so
it can't be left half-written; heard lines and camera frames wait on the phone and are saved once
space is back. A notice says what is paused. Tests: `robustness-fixes-test.ts`, `StorageGuardTest`.

- When space is short only video stops; keyframes and database writes go on.
- No reaction to Android's low-memory signal: both models stay loaded until Android kills the app.
- Voices that haven't consented: a voice centroid row is stored for them (`speakers`), which may go
  against SPEC 4 ("not stored"). Flagged only.

## Lite features (26 Nov 2026)

**How.** Research and photo edits: the app built from this branch on the Pixel 5 (CPU only,
8 GB, Wi-Fi), run through the bench links (`bench/README.md`) with made-up requests and a made-up
photo (generated, no real person). Image generation: stable-diffusion.cpp (MIT) built for
Android and run over adb from a temporary folder, files deleted after. Licences and decisions:
ADR 0006 "Lite versions of cloud-app features".

### Image generation (trial; now built, see ADR 0006)

| 512×512 on the Pixel 5, 6 CPU threads   | Time per image (5 prompts)               | Peak memory | Download |
| --------------------------------------- | ---------------------------------------- | ----------- | -------- |
| SDXS-512, 1 step, 8-bit, TAESD decoder  | 37–43 s (model step ~26 s, decode ~12 s) | 1.1 GB      | 693 MB   |
| SDXS-512, same, 4 threads               | 46 s                                     | 1.1 GB      | 693 MB   |
| SDXS-512, 16-bit weights                | 50 s                                     | 1.1 GB      | 893 MB   |
| SD 1.5 8-bit + LCM-LoRA, 4 steps, TAESD | 240 s (56 s per step)                    | 2.0 GB      | 1.9 GB   |

- Quality (sample images judged by eye: a bicycle, a cartoon fox, a mountain lake, a portrait
  with a dog, a birthday card, coffee cups): SDXS gives clean, pleasant pictures in all styles;
  hands and small objects are sometimes odd (a bicycle with merged wheels) and any text in the
  picture is gibberish. SD 1.5 + LCM is a little more accurate but 6× slower.
- Faster phones: CPU-only ≈ 12–15 s with SDXS on a Snapdragon 8 Gen 2 / A15-class phone (2.5–3×
  the Pixel 5 per core, estimated); a few seconds with Core ML or a recent NPU (published).
- Verdict: usable on phones with ≥ 6 GB RAM as an optional download; built as "Make pictures"
  with the licence terms in the app (ADR 0006). The in-app build is not yet timed on the phone.

### Photo edits: background model

| Background cut-out model (laptop, 4 threads, 4 made-up images) | Size   | Time per photo | Masks                                   |
| -------------------------------------------------------------- | ------ | -------------- | --------------------------------------- |
| U²-Netp (chosen)                                               | 4.6 MB | 0.8–1.1 s      | Clean on people, a dog, cups, a bicycle |
| Silueta                                                        | 44 MB  | 1.3–1.8 s      | About the same                          |
| ISNet general                                                  | 179 MB | 5–7 s          | Worse with the same preprocessing       |

## Chat features (27 Nov 2026)

Edit / Try again, "How Sidekick answers", formatted answers, private facts kept out (PR #39).

- Laptop: 19 new unit tests (`__tests__/chat-features-test.ts`): which exchange may be redone,
  taking the last turn back (gone from the chat state, model chat restarts), the answer-style
  line in the prompt (trimmed, capped at 300), the "(spoken)" mark, the markdown parser (recipe
  steps and bullets, bold, small tables, half-written marks while streaming), read-aloud cleanup
  (no bullets, stars or table pipes), the private-topic line in the owner-fact prompt and the
  parser for the model's person-fact check. Full suite, tsc and eslint pass.
- Release APK built (`sk-chatfeat1.apk`); the bundle carries the new prompt and settings text.
- **Phone: not checked yet.** When the phone lock came free (00:57) the Pixel 5 was on its lock
  screen, so nothing was installed or tapped. Still to do on the phone, made-up content only:
  screenshots light/dark of a formatted recipe; Edit and Try again replacing the last exchange
  (and its memory row); the answer-style box obeyed ("call me Captain Nemo, metric units");
  `sidekick://bench?run=facts` (8 made-up owner lines and 8 person lines, half private) to see
  that the model leaves private ones out. Read aloud is audible: waits for the owner's OK.

## Rules vs model, thinking (27 Nov 2026)

Owner: "It should be dynamic and intelligent, hardcoding is brittle, unless it's always better
like doing calculations etc." and "better to be slow than unreliable". So what a request needs is
now read by the model, and code only computes (sums, units, dates, time zones) as tools.

**What is measured.** The 143 cases above (`bench/answers/cases.ts`) plus 56 new ones
(`bench/answers/decide-cases.ts`): the same tools in other words (26, "Pop a seven minute
countdown on for the eggs", "Could you get me up at half six tomorrow?"), other languages (8),
near-misses (14), look-ups (4) and plain questions (4). Each sorter is scored on whether it chose
answer, lookup or the right tool. Pixel 5, CPU, Gemma 4 E2B. Run: `bash bench/answers/run-decide.sh
decide <variant>` (bench/README.md).

### Word lists in the app

| `src`, regexes of 3+ alternatives | Before (main)    | After            |
| --------------------------------- | ---------------- | ---------------- |
| Regexes / alternatives / files    | 454 / 4,138 / 47 | 205 / 1,927 / 37 |

Removed: the rule tracer and every list that read the user's words to choose what to do
(phone commands, phone controls, extras, texts and calls, intents, scheduled sends, quick answers,
translate, recap requests, feedback, read-back yes/no, lookup and news detection, the browser-link
and date-line rules, the tool router's word lists). What is left, and why:

- **Code reading text the app wrote itself** (never the user's): reminders, routines, location and
  weather handlers parse the canonical request `tools.ts` builds from the model's arguments.
- **Computing:** time spans ("last Tuesday" → dates), clock times, units and number words.
- **Not yet moved (answer path, next):** recall intents, "something I saw", follow-ups, people
  context, speech clips, the unusual-time-words check, camera-setting wording, the search-query
  fallback.

### Sorters tried (199 cases)

| Variant (system prompt)                               | Prompt | Right                  | Median    | Mean  |
| ----------------------------------------------------- | ------ | ---------------------- | --------- | ----- |
| Old rules + tool router (main)                        | —      | 143/143 own set; below | —         | —     |
| fused-lookup: the answer pass also says LOOKUP / DO   | 266 t  | 73/199                 | 1.8 s     | 2.6 s |
| classify: tool names only                             | 164 t  | 113/199                | 1.7 s     | 3.5 s |
| **catalog: one line per tool, cached, one word back** | 562 t  | **172/199**            | **1.7 s** | 4.0 s |
| catalog + filling the chosen tool's arguments         | 562 t  | 166/199                | 6.3 s     | 7.8 s |

The old rules' new-case numbers are offline (main's `route-trace-logic.ts` on the 56 cases): only
26 were decided by a rule, 4 of them wrongly ("Could you get me up at half six tomorrow?" →
navigation, "Is my phone about to die?" and "You're talking too fast for me" → answered); the
other 30 waited ~5 s or more for the router, 2 of them without the right tool on offer and 7 of
them plain questions. Their 143/143
is on the wordings they were written for. Also tried: the full tool catalog in the answer prompt
(slow, long prompt every turn) and nearest-neighbour on embeddings (needs labelled examples for
each wording). Catalog by set: knowledge 15/15, arithmetic 12/12, dates 14/14, units 8/8,
reasoning 8/8, tools 53/63, near-misses 10/14, refusals 2/5, multi-step 3/4; new: paraphrase
21/26, other languages 7/8, near-misses 12/14, look-ups 3/4, questions 4/4. CPU for the whole
catalog run: 180,354 ticks over 801 s.

**Built: catalog.** Its ~560-token prompt is read once and kept in a second prefix cache next to
the chat's (`cacheSystem` in `LlmEngine.kt`), so a request costs its own words and one word of
reply. Where it still misses: alarm vs reminder ("wake me at 7", Spanish too), routine vs reminder
for one-off routines, camera vs camera settings, "stop listening", "text me a fun fact" (the fill
step refuses a message to "me", and the model then answers), talk about the weather on Mars.
The fill step's misses in the run above were mostly arguments the schema refused (phone settings
as `{torch: true}`); such a call is now asked once more with the reason it was refused (`fillTool`).
Still to measure on the phone: the built version end to end (catalog with the lookup and news
lines, plus fill), pending phone time.

### Thinking

Gemma 4's thinking mode (`thinkingBudget` per turn: off, a token budget, or -1 for no limit) is
wired on Android (`LlmEngine.kt`, LiteRT-LM `ThinkingConfig`) and off by default. Benches:
`thinking <budget|handoff>` (16 hard questions where working helps, 8 everyday ones,
`bench/answers/thinking-cases.ts`) and `background <budget>` (15 note, fact, who-is-who, recap and
photo tasks on made-up material, `bench/answers/background-cases.ts`). "handoff" lets the answer
pass reply THINK and is then asked again with thinking on (`wantsThinking`, `decide-logic.ts`).

Not yet measured: the phone was locked (keyguard) whenever this work had it, and the PIN is the
owner's. Until there is data the app keeps the default (thinking off) everywhere. iPhone: the
bundled Swift LiteRT-LM API has `ThinkingConfig` (enable + token budget), but `Llm.swift` does not
pass `thinkingBudget` yet.

## Chat models compared (27 Nov 2026)

Is there a better small model than Gemma 4 E2B? Decision and survey in
[ADR 9](decisions/0009-chat-model-compare.md); harness in `bench/models/`. Pixel 5, CPU, 22
made-up prompts in the app's own prompt formats, answers scored blind (0–2 each).

| Run                         | First word, median (memory / tool / plain / photo) | Write speed           | Peak memory (text / photo) | Blind score |
| --------------------------- | -------------------------------------------------- | --------------------- | -------------------------- | ----------- |
| **Gemma E2B, 0.19.1** (now) | 4.9 / 4.5 / 3.1 / 19.3 s                           | 6.7 tok/s, 4.2 word/s | 2.27 / 3.14 GB             | **41/44**   |
| Gemma E2B, LiteRT-LM 0.20.0 | 4.7 / 4.8 / 3.6 / 22.1 s                           | 8.3 tok/s, 5.1 word/s | 3.11 / 3.87 GB             | 41/44       |
| Qwen3.5-2B vision, 0.20.0   | 7.8 / 6.8 / 5.5 / 34.8 s                           | 4.8 tok/s, 3.0 word/s | 4.24 / 4.58 GB             | 38/44       |
| Qwen3.5-4B int4, 0.20.0     | 27 / 24 / 17 s (text only)                         | 2.7 tok/s, 1.7 word/s | 4.5 GB                     | 33/38       |
| Qwen3.5-2B vision, 0.19.1   | –                                                  | 4.8 tok/s             | 4.3–4.7 GB                 | 21/44       |

- Keep Gemma: Qwen 2B is slower, larger and slightly worse; Qwen 4B is too slow on this phone.
- Qwen3.5 on LiteRT-LM 0.19.1 (the app's version) echoes the prompt and writes nonsense; fine on
  0.20.0.
- LiteRT-LM 0.20.0 gives Gemma about 24% faster writing, but about 0.8 GB more peak memory here.
- Load: Gemma 2.9 s (warm cache); Qwen 2B 86 s the first time (builds a 2.8 GB cache), then 14 s.

## LiteRT-LM 0.20.0 (27 Nov 2026)

Moving from 0.19.1, after the chat-model bench (ADR 9) found Gemma 4 E2B writes about 24% faster
on 0.20.0 (Pixel 5, CPU: 8.3 against 6.7 tok/s, same blind score) but with about 0.8 GB higher
peak memory. Decision and details in [ADR 10](decisions/0010-litert-lm-0.20.md).

- **The extra memory came from the bench, not the runtime.** The 0.20.0 run built its weights
  cache in the same process (10 s load instead of 2.9 s), and the bench reports the highest memory
  the process ever reached. Building the cache costs about 0.9 GB at the peak on the Pixel 5 with
  either version: Qwen3.5-2B on 0.19.1 reached 4.32 GB after a load that built the cache, and
  3.42 GB after a load from it.
- PC check (same Gemma file, Python `litert-lm`, fresh process each time): 0.20.0 uses slightly less
  memory than 0.19.1 at every context size, and writes 15–130% faster. The default context is
  4096 tokens in both.

| Gemma 4 E2B on a PC (x86 CPU) | 0.19.1, after load / text / photo | 0.20.0, after load / text / photo |
| ----------------------------- | --------------------------------- | --------------------------------- |
| Cache built in the run        | 1.51 / 1.59 / 2.11 GB             | 1.37 / 1.45 / 1.95 GB             |
| Cache already there           | 1.38 / 1.46 / 1.98 GB             | 1.36 / 1.44 / 1.96 GB             |

- The cache format changed, so the first load after the update rebuilds it once, like a first
  install. App settings unchanged (default 4096-token context, 140 image tokens per photo).
- **Phone: not checked yet.** When the phone lock was taken the Pixel 5 was on its lock screen, so
  nothing was installed. Still to do with `sk-litert20.apk`: the Speed test bench by deep link,
  twice (the first run rebuilds the cache), with first word, words/s and peak memory
  (`dumpsys meminfo`) for text and photo, against 0.19.1.

## Interpreter (26 Nov 2026)

**What is measured.** 20 made-up travel turns (taxi, hotel, café, pharmacy, shop) in 7
languages, each with an English and a foreign side (`bench/interpreter/phrases.json`), sent with
the app's own prompts (`prompts.ts`); 10 owner lines said to Sidekick ("stop interpreting", "can
you switch to French") among the ordinary ones for the control check; made-up speech for the
same lines from Kokoro (Apache-2.0) for speech recognition. chrF (sacrebleu) against the
reference; WER (CER for Japanese). Audio was deleted after the run.

### Translation: Gemma 4 E2B vs Bergamot (laptop, 20 turns × 7 languages)

chrF, into the language / into English:

| Language   | Gemma 4 E2B     | Bergamot (Firefox Translations) |
| ---------- | --------------- | ------------------------------- |
| Arabic     | 70.5 / 71.8     | 70.0 / 69.9                     |
| German     | 73.5 / 78.4     | 71.4 / 73.2                     |
| Spanish    | 73.2 / 77.3     | 75.8 / 73.1                     |
| French     | 74.8 / 81.0     | 74.5 / 80.3                     |
| Italian    | 76.7 / 79.9     | 69.5 / 73.1                     |
| Japanese   | 52.1 / 59.7     | 42.5 / 53.5                     |
| Portuguese | 70.7 / 83.3     | 77.6 / 73.8                     |
| **Mean**   | **70.2 / 75.9** | 68.7 / 71.0                     |

Round trip English → language → English (Gemma): chrF 79.3 (Arabic 82.2, German 85.9, Spanish
84.3, French 77.4, Italian 85.1, Japanese 59.4, Portuguese 80.9). Spot check by reading: no
meaning errors from Gemma, no line left untranslated; small slips ("nueces"/"noci" for nuts in
general, French "Est-ce pas grave", dropped greetings). Bergamot reversed a Japanese medical line
("if the fever doesn't go down in three days" → "if you don't have a fever"). Bergamot takes
130–360 ms a turn on one thread, about 10× faster.

### On the phone (Pixel 5, CPU, Gemma 4 E2B via LiteRT-LM)

| What                                                    | Result                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Translation turn (62 turns)                             | median 5.3 s, 90th percentile 6.0 s; first words after 3.2 s                                         |
| chrF (Arabic, Japanese, Portuguese, 10 + 10 turns each) | 66.1 / 71.8, 53.1 / 57.6, 71.1 / 82.1 — within 5 points of the laptop                                |
| English hearing (Parakeet v2, 20 clips)                 | 0.56 s median per line, 0.84 s worst                                                                 |
| Peak app memory (PSS)                                   | 3.1 GB during the bench run (Gemma loaded)                                                           |
| Downloads                                               | Whisper small 375 MB, Parakeet v3 487 MB (once, kept); Gemma and the voices are already on the phone |

Logcat over Wi-Fi lost some lines, so 122 of the 200 translation cases were recovered (all
three languages above fully, the others not). The phone runs of Parakeet v3 and Whisper small
did not happen: the 652 MB Parakeet v3 encoder didn't finish copying to the phone and the phone
slot ran out; their accuracy below is from the laptop.

### Speech recognition (laptop, made-up audio)

WER % (CER for Japanese):

| Model         | en  | de   | es  | fr   | it   | pt   | ja    |
| ------------- | --- | ---- | --- | ---- | ---- | ---- | ----- |
| Parakeet v3   | 0.9 | 4.8  | 5.8 | 3.8  | 8.1  | 6.0  | –     |
| Whisper small | 1.6 | 8.8  | 4.5 | 6.1  | 5.7  | 11.2 | 63.2  |
| Whisper base  | 4.7 | 10.8 | 6.4 | 10.4 | 13.0 | 15.7 | 76.2  |
| SenseVoice    | 9.1 | –    | –   | –    | –    | –    | 111.6 |

Parakeet v3 for the European languages, Whisper small for the rest. Japanese is not verified:
every model failed on Kokoro's Japanese voice, which points at the made-up audio.

### Owner talking to Sidekick mid-conversation (laptop, 27 Nov)

The owner's turn reply says it: `SIDEKICK: NO / END / LANGUAGE: <language>`, then `SAY:`. No
word list, no second call. 60 owner lines (per language 5 said to Sidekick, 5 that only look like it,
10 ordinary) in Spanish, German and Japanese sessions, by how the question is put:

| Asked in the same reply as                            | Ordinary (45) | Stop (9) | Switch (6) | Laptop ms |
| ----------------------------------------------------- | ------------- | -------- | ---------- | --------- |
| "Who is this said to? OTHER / END / LANGUAGE"         | 42–45         | 0–9      | 0          | 1100–3900 |
| "An instruction to you about the interpreting?" (app) | **42**        | **9**    | **6**      | 1350      |
| The same without "requests to them like …"            | 41            | 9        | 5          | 1150      |
| JSON `{"for_interpreter": …}`                         | 35            | 9        | 2          | 1680      |
| Before: a second call, only with a word like "stop"   | 45            | 9        | 3          | +3.3 s    |

The 3 misses: "Thank you very much, that's all for today" ended the session (all three
languages). Owner turns inside the conversations, with context: 0 of 30 taken as said to
Sidekick. Translation quality unchanged (chrF en→xx 66.6 vs 66.3, xx→en 71.8). On the phone
this saves the 3.3 s second call on those lines and adds about 70 prompt tokens to every owner
turn (not re-timed on the phone).

Starting the interpreter (`routing.ts`, the app's sorter and then the tool's arguments):

| Request                                                                    | As its own tool | translate + `talk`  |
| -------------------------------------------------------------------------- | --------------- | ------------------- |
| 5 conversation requests ("help me talk to this taxi driver in Spanish", …) | 1–2 of 5        | 4 of 5              |
| "translate 'where is the station' into Spanish"                            | translate       | translate (no talk) |
| 3 questions about a language                                               | answer          | answer              |

The miss: "translate for me and the driver, he speaks German" translated the sentence.

### Still weak / not measured

- Parakeet v3 and Whisper small on the phone (speed and memory while hearing a language).
- Anything heard out loud: real mic turns, a real speaker of the language, and the phone voices
  speaking translations (no sound tests without the owner's go-ahead).
- The interpreter screen on a phone, and everything on iPhone (Apple speech, voices; the iOS
  code was not compiled here).
- A turn of ~5 s is usable but slow; Bergamot is the faster fallback if it feels too slow.
- The one-call stop / switch and the translate + `talk` start are measured on the laptop only.

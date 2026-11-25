# Limits (measured)

What each feature does, where it stops, and what was measured on the **Pixel 5** (Snapdragon
765G, 8 GB RAM of which Android reports 7.3 GB, CPU only, Android 14) with the USB Arducam
plugged in. Build sk44 (25 Nov 2026). "Other phones" says what is expected to differ.
Bugs found are listed per feature: fixed (with the fix) or left (with why; also in ADR 0006).

## Test phone state

- Storage: 13 GB free of 109 GB (89% used). Sidekick's models and data: 3.2 GB.
- RAM: Sidekick uses about 1.1 GB (PSS) with the chat model loaded; Android shows < 100 MB free
  at times (the rest is cache it can reclaim).

## Listening (background mic)

Works:

- Separate sentences with gaps of 3–4 s are each saved as their own line with audio.
- An 18 s monologue is transcribed in one piece, word-perfect.
- Speaking 9 s after turning Listen on is caught.
- Live camera on at the same time doesn't change accuracy.
- Listen stays on after the app is killed or force-stopped and reopened (fixed in sk44).

Bugs:

- **Fixed: first word clipped.** The speech detector starts a line ~0.1–0.3 s after the voice
  does, so "The parcel for flat three…" was saved as "Parcel for flat 3…". Each line now keeps up
  to 0.4 s of audio before the detected start (never reaching into the previous line).
  Verified on the phone: "The parcel for flat 3 is at the front desk."
- **Fixed: Listen didn't come back after the app was killed.** The choice is now remembered and
  listening restarts when the app is opened.

## Voices (who said it)

- Computer voices: Zira was named "Clara (auto)", Mark "Someone" (correct).
- David was labelled "You". Cause: the owner voice on the test phone had been learned from David
  during earlier push-to-talk tests (test sound through push-to-talk teaches the owner voice).
  Not loose matching. Left: a real owner talking to their phone doesn't hit this; see ADR 0006.

## Memory: facts about you

- **Fixed: template suggestions** ("My name is [Name].", "My birthday is [Date].") were left from
  before the fact reader rejected them. They are now removed when the app opens, and never saved.
- Odd phrasings like "My need for spare keys." come from other voices that were labelled as the
  owner (see Voices). Suggestions only; the owner approves or dismisses each.

## Chat model and memory search model together

- Owner decision (25 Nov): both may stay loaded on phones with ≥ 6 GB RAM while Android isn't
  short of memory; otherwise one unloads first and live-camera frames wait. The Pixel 5 keeps
  both. 4 GB phones (iPhone 13 mini class) never hold both.

## Battery

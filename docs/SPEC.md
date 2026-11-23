# Product spec

Sidekick is a general-purpose, fully on-device camera + audio assistant with the context of your life. Every feature is user-toggleable.

## Features (MVP unless marked later)

1. **Ask** — wake word (default "Hey Sidekick", changeable) and a big button (later: widget / quick tile). Voice or typed. Streaming answer, spoken and shown as text.
2. **Capture** — one tap = photo (+ optional voice note) tagged with time, place and who was around. Later: Android default-assistant role ("ask about my screen"); iOS share-sheet screenshot.
3. **Conversations** — ambient transcription while listening is on. Automatic speaker separation from voice embeddings with **no enrolment**: the owner's voice is learned from wake-word / ask utterances, other voices are clustered. Names are suggested from conversation context ("thanks, Sam"); the user confirms or fixes. Tagged with time of day and place (offline place names). Auto-pause on silence and at user-chosen places/times.
4. **Consent mode** — default ON in all-party-consent jurisdictions (EU, CA, FL, IL, MD, MA, MT, NH, PA, WA, …). Detects verbal consent ("is it OK if I take notes?" → "yes"). Voices that have not consented are not stored. A visible mic indicator is always shown while listening.
5. **Memory** — everything goes into encrypted on-device memory; unlimited; instant search going back years by meaning, person, place or date. Detail questions ("what did that sign say this morning?") retrieve the moment from the vector index, then re-open the **original image** and read it with the vision model. Hybrid retrieval: embeddings + OCR text + keyword; captions only when cheap. People pages. Saved facts vs inferred facts (inferred facts need approval).
6. **Follow-ups** (later) — to-dos, events, reminders, optional daily digest. Never written to a calendar without confirmation.
7. **Your data sources** (later) — notes, user-picked folders (Storage Access Framework / document picker), optional contacts, calendar, location; Android: notifications.
8. **Web search** (later) — optional, off by default; the UI shows an "offline" badge otherwise.
9. **Data control** — export everything (JSON + media zip); delete an item, person, time range or everything; retention settings.

## Not in scope

- Self-coding or autonomous agents.
- Any action without the user's confirmation.
- Accounts, telemetry, ads.

## Later targets

Smart glasses, a dedicated camera, laptop. Keep the engine portable.

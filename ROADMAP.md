# Roadmap

Each step reports what was verified **on a device** vs only built (phone results: `docs/LIMITS.md`).
Current phase details: `docs/PLAN-v2.md`. Left out or rejected on purpose: ADR 0006.

## Done (release 1)

- **Foundation:** public repo (Apache-2.0), docs, CI, privacy guard.
- **Android MVP (Pixel 5):** model download, Ask (camera, voice, typed, streaming spoken answers), background Listen (wake word, speech to text, who said it), encrypted memory with search and recall, Settings with consent, export and delete.
- **Assistant:** follow-ups, people, folders / contacts / calendar sources, web lookup, default-assistant role, photo search and OCR, tile and widget.
- **Plan v2:** one continuous chat with off the record, live camera memory (phone or USB camera) with recall of the actual frames and clips, storage screen and forecast, zero-tap first run, phone integrations with draft cards and outbox, routines, location memory, hands-free and read-back, phone controls, app lock, Google Drive backup, conversation notes, other languages heard (translated to English).

## Release 1 (launch)

- Owner steps in `docs/RELEASE-OWNER-STEPS.md`: Play Console app and first upload, website DNS (robert-whiteley.github.io/sidekick-site), store declarations (data safety, content rating, foreground services, health), Google OAuth verification (Gmail send, Tasks, Drive), store screenshots, production AAB and "go".
- **iPhone (App Store):** built from the same code (ADR 0006 "iPhone"); owner steps in `docs/RELEASE-OWNER-STEPS.md` section 10, listing in `docs/store/app-store.md`. Not yet built on EAS or run on an iPhone.
- Finish phone verification of the plan v2 work (build sk46; `docs/LIMITS.md` covers sk44–sk45).

## Release 2

- Texts and call log while Sidekick is the default assistant: built, but READ_SMS, SEND_SMS and READ_CALL_LOG stay in `app.json` `blockedPermissions` until Play approves the SMS / Call Log declaration (`docs/store/permissions-declaration.md`).

## Future

- **Full localisation** in the 25 Parakeet v3 languages: every string, command rule, voice and test per language; each new feature then costs 25 translations (ADR 0006).
- **Auto-detect the spoken language:** needs Parakeet v3 (worse English) or a language-ID model in front of v2; now English-only plus optional translation of heard speech.
- **iPhone, after the first TestFlight build:** run it on the iPhone 13 mini (memory with the model loaded, speed, download), then the App Store listing (`docs/store/app-store.md`). Possible later: Natural voice on iPhone, a home-screen widget and Siri shortcuts.
- **Wearables:** Omi pendant first (open MIT protocol), then smart glasses; each needs its own connector (`docs/FUTURE-wearables.md`).
- **Place routines with the app closed:** needs ACCESS_BACKGROUND_LOCATION and a Play declaration with review, often refused.
- **Restore from Google Drive in the app:** merging speakers, vectors and encrypted media is not simple; restore is manual for now.
- **Monthly recurrence and end dates for routines and reminders:** only daily / weekdays / one weekday so far.
- **Camera watches with the app closed:** "tell me when you see X" runs only while Sidekick runs.
- **Android AppFunctions:** limited to allow-listed system agents, so a normal app can't use them yet.
- **More app hand-offs:** Bolt and Lyft destinations (no public Bolt deep link), Netflix / eBay search, MMS pictures.
- **Self-hosted quick-fix server** (expo-open-ota, MIT) if over 1,000 monthly users: the EAS free limit.
- **Speech speed kept by the background service:** the speed set in the app isn't yet used for answers spoken from the service.
- **Bigger model on newer phones** (Gemma E4B, GPU): too slow and too big for the Pixel 5; smarter on phones with ≥ 8 GB and a fast GPU.
- **Split audio** (headset mic for commands, camera mic for conversation): only a probe exists; needs a phone that records two inputs at once, untested.
- **Model comparison on a graded set** (E2B vs E4B, int4 vs int8, frames per question): waits for a newer test phone; the Pixel 5 runs only E2B on CPU.
- **Camera pipeline measurements** (frames per second embedded, OCR per frame, video encoder load): not measured yet.
- **Recommend a better phone** when a feature is missing or slow on this one: not built.
- **Voice edits of recipient, subject and time** on a draft: text only by voice now; tap Edit for the rest.
- **Health Connect** (sleep, heart rate): steps work; Health Connect needs its own Play declaration.
- **Smart-home control:** needs an account per ecosystem; a local Home Assistant link is possible.

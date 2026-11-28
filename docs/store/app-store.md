# App Store Connect — listing and answers (iPhone)

App Store Connect → Apps → Sidekick (Apple ID 6838426860, bundle ID `app.ondevice.sidekick`).
Paste each item where it says. The texts are the Play listing (`fastlane/metadata/android/en-GB/`)
with the Android-only features taken out, so nothing here promises what the iPhone app can't do.
Checked against the code on 26 Nov 2026.

## App information (left menu → App Information)

| Field              | Value                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| Name               | `Sidekick – On-device AI` (already set; 23 of 30 characters)            |
| Subtitle           | `Private AI that works offline` (29 of 30)                              |
| Primary category   | **Productivity**                                                        |
| Secondary category | **Utilities** (optional)                                                |
| Content rights     | **No**, it doesn't contain, show or access third-party content          |
| Age rating         | see below                                                               |
| Privacy Policy URL | `https://robert-whiteley.github.io/sidekick-site/privacy` (App Privacy) |

Content rights: online lookup quotes a few lines from Wikipedia and DuckDuckGo answers with a link,
like a search box; Apple's question is about apps that show licensed content (films, music, books).

## Version 1.0 (left menu → iOS App → 1.0 Prepare for Submission)

**Promotional text** (170 max; can change any time without a review):

```
An AI assistant that runs on your iPhone. Ask by voice or text, show it a photo, and it remembers for you. Works offline; your data never leaves the phone.
```

**Description** (4000 max):

```
Sidekick is an AI assistant that runs entirely on your iPhone. Ask it anything, show it what you're looking at, and it remembers for you — without sending any of it anywhere.

PRIVATE BY DESIGN
• No account, no sign-up, no ads, no tracking.
• Everything is processed on your iPhone and stored there, encrypted.
• Works offline, even in airplane mode, once its AI model is downloaded.
• Online lookup is off until you turn it on. Even then, only the search words are sent.
• Export everything, or delete anything, any time. Deleting the app removes it all.

ASK ANYTHING
• Hold the mic and speak, or type. Answers are spoken and shown in the chat.
• "What am I looking at?" — take a photo and ask. Sidekick reads the text in photos too.
• Ask from Siri, the Shortcuts app, the Action Button or Control Center: "Ask Sidekick" opens the app with your question.
• Scan QR codes and barcodes from a photo.

REMEMBERS FOR YOU
• Remembers what you tell it and the photos you ask about, so you can ask later: "Where did I park?", "What was the wifi password on that sign?"
• Search your memory by meaning, person, place or date.
• Keeps notes on the people you mention, with facts you approve.
• Recaps of any time or topic: "recap what we talked about this week".
• Optionally notes the town you're in (from a place list built into the app), so you can ask "what did I save in Bristol?".

GETS THINGS DONE — ALWAYS WITH YOUR OK
• Suggests reminders, to-dos and events from what you say; nothing is added until you approve it.
• Recurring reminders ("every Monday at 9").
• Reads and adds calendar events, and looks up contacts and birthdays.
• "Navigate me to the station" opens directions straight away.
• Battery, storage and today's step count when you ask.

OPTIONAL EXTRAS (OFF UNTIL YOU TURN THEM ON)
• Online lookup through Wikipedia and DuckDuckGo, news headlines and the weather.
• Face ID lock for the app.

GOOD TO KNOW
• Sidekick uses a small AI model that fits on a phone. It is good at everyday help but is not an expert on deep specifics, and it can make mistakes.
• The first download is about 3 GB; Wi-Fi is recommended. It carries on in the background.
• Needs enough free storage for the model; Sidekick checks before downloading.
• On iPhone, Sidekick answers while it is open: Apple doesn't let apps keep listening or filming in the background.
```

**Keywords** (100 max, commas, no spaces; the name's words are already indexed):

```
assistant,offline,private,chatbot,local,llm,memory,voice,notes,reminders,recall,ocr,scan,camera
```

(95 characters.)

**Support URL**: `https://robert-whiteley.github.io/sidekick-site/support`
**Marketing URL**: `https://robert-whiteley.github.io/sidekick-site` (optional)
**Copyright**: `2026 Robert Whiteley`
**Version**: `1.0` (set by the build; `appVersionSource` is remote, EAS raises the build number)

**Screenshots** (6.5" display, 1284 × 2778, JPEG; 3 to 10): take them on the iPhone 13 mini from the
TestFlight build (side button + volume up), test data only, copy them to the PC and run
`node scripts/iphone-screenshots.mjs <folder>`. It writes
`fastlane/metadata/ios/en-GB/screenshots/iphone65-1.jpg` … in that size (the 13 mini's
1080 × 2340 has the same shape, so it's scaled, not stretched). Drag them into the **6.5" Display**
box; App Store Connect uses them for the other sizes. Suggested order: the chat answering a
question; "what am I looking at?" with a photo; memory recall ("where did I park?"); a reminder
card; Privacy settings. The Android screenshots can't be reused: they show the USB camera, Listen
and background filming, which the iPhone app doesn't have (Apple rejects screenshots of features
that aren't there, guideline 2.3.3).

**App Review Information**

- Sign-in required: **No** (no account).
- Contact: your first and last name, phone and email `info@sashy.ai` (Apple only, not shown).
- Notes:

```
Sidekick runs a small AI model on the device. On first launch it downloads the model (about 3 GB) from Hugging Face; please use Wi-Fi and allow a few minutes. After that it works offline. There is no account, server or analytics. Try: "What can you do?", take a photo with the camera button and ask "what am I looking at?", "remind me at 6pm to call Sam", "how many steps today?", or "Hey Siri, ask Sidekick" (the app opens with the question). Online lookup is off by default (Settings > Privacy).
```

## Age rating (App Information → Age Rating → Edit)

Answer **None / No** to every content question (violence, sexual content, profanity, horror,
drugs, gambling, contests, medical, mature themes) and every capability question:

| Question                           | Answer | Why                                                         |
| ---------------------------------- | ------ | ----------------------------------------------------------- |
| Unrestricted web access            | No     | No browser; lookup quotes set sources, links open in Safari |
| User-generated content             | No     | Nothing is shared between users                             |
| Messaging and chat (between users) | No     | The chat is with the on-device model only                   |
| Advertising                        | No     | —                                                           |
| Parental controls / age assurance  | No     | —                                                           |

Then choose **18+** in "Age Rating Override" (or "Restrict to 18+"). Why: the answers come from a
general AI model that can be asked anything, and Apple has asked general-purpose AI chat apps for
the oldest rating; it also matches the Play listing (adults only).

## App Privacy (left menu → App Privacy)

- Privacy Policy URL: `https://robert-whiteley.github.io/sidekick-site/privacy`
- "Do you or your third-party partners collect data from this app?" → **No, we do not collect data
  from this app** → Save → **Publish**. The label then reads **Data Not Collected**.

Why that is true (Apple: "collect" means sent off the device so that the developer or its partners
can keep it longer than the request needs):

- No server, account, analytics, crash reporting, ads or tracking SDK. No push notifications.
- Model download (huggingface.co, github.com): file requests only.
- Quick fixes (expo-updates, u.expo.dev): runtime version, platform and update id only; no user data.
- Online lookup and weather (off by default): the search words (names taken out) or the location
  rounded to ~1 km go to Wikipedia, DuckDuckGo, GDELT or MET Norway for that one answer, at the
  user's request. Nothing reaches the developer.
- The Google features (Gmail, Tasks, Drive) are Android only, so the iPhone app never signs in.
- Not tracking: nothing is linked across apps or companies (no App Tracking Transparency prompt).

## Pricing and availability (left menu → Pricing and Availability)

- Price: **Free** (USD 0). No in-app purchases.
- Availability: **all countries and regions except China mainland**. Why: AI apps there need a
  government Security Assessment and an AIGC (generative AI) filing with a local entity; see ADR 0006. Hong Kong, Macau and Taiwan are fine.
- Distribution: Public. Apple Silicon Mac and Apple Vision Pro: **untick** (not tested there).

## Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in `app.json`, so App Store Connect doesn't ask per
build. Sidekick encrypts its own data on the phone (SQLCipher) and uses HTTPS; its main function is
not encryption, which is exempt (US EAR Category 5 Part 2, Note 4). No documents to upload. France:
no declaration needed for the same reason.

## Permission texts the user sees (`app.json`, iOS only)

Camera, microphone, speech recognition, photo library (pick and save; read only after the user turns on Phone search, all or limited library), calendars, contacts, Face ID,
location while using the app (place names) and Motion & Fitness (steps). No "always" location,
reminders, Bluetooth or tracking prompts.

# Third-party notices

Every model and library shipped with or downloaded by Sidekick, with its licence. All allow commercial use.

## Models (downloaded at runtime)

| Component                                                                    | Licence                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| Gemma 4 E2B and E4B (`.litertlm`)                                            | Apache-2.0                                              |
| EmbeddingGemma 2 Text Vision 440M (`.litertlm`)                              | Apache-2.0                                              |
| Silero VAD v6.2.3                                                            | MIT                                                     |
| Parakeet TDT 0.6B v2 int8 (sherpa-onnx export)                               | CC BY 4.0                                               |
| Parakeet TDT 0.6B v3 int8 (sherpa-onnx export; other languages, optional)    | CC BY 4.0                                               |
| sherpa-onnx KWS zipformer (GigaSpeech)                                       | Apache-2.0                                              |
| 3D-Speaker CAM++ (VoxCeleb)                                                  | Apache-2.0                                              |
| PaddleOCR PP-OCRv6 small det + rec (PaddlePaddle ONNX exports)               | Apache-2.0                                              |
| Kyutai Pocket TTS 100M (sherpa-onnx int8 export)                             | CC BY 4.0 (weights, © Kyutai), Apache-2.0 (ONNX export) |
| Pocket TTS reference voice `bria.wav` (kyutai-labs/delayed-streams-modeling) | Apache-2.0                                              |
| Smart Turn v3.2 (pipecat-ai/smart-turn-v3, fp32 ONNX)                        | BSD-2-Clause (© Daily)                                  |

## Data

| Component                                                                             | Licence                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GeoNames cities500                                                                    | CC BY 4.0 — data from [GeoNames](https://www.geonames.org/), bundled as `geo/places500.bin` in the native module's assets (every town and village with ≥ 500 people: names, coordinates, population, country and admin1 codes; built by `scripts/build-places.mjs`) |
| MET Norway Locationforecast 2.0 (weather data, fetched only when Online lookup is on) | CC BY 4.0 and NLOD 2.0 — "Based on data from MET Norway" ([api.met.no](https://api.met.no/)); credited with each weather answer. Not bundled.                                                                                                                       |

## Online content (only when Online lookup is turned on)

| Source                                            | Licence / terms                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wikipedia text (via the MediaWiki API)            | CC BY-SA 4.0 — each answer shows "Source: Wikipedia — article title" linking to the article, with the licence; nothing is stored or redistributed in bulk                                                                                                                                                                                                                             |
| DuckDuckGo Instant Answer API                     | Free, no key; results attributed to DuckDuckGo and to the original source (usually Wikipedia, CC BY-SA 4.0) with a link                                                                                                                                                                                                                                                               |
| SearXNG (a server the user chooses)               | Results belong to the linked sites; shown as title + link only                                                                                                                                                                                                                                                                                                                        |
| Wikipedia "Portal:Current events" (MediaWiki API) | CC BY-SA 4.0 — news questions only; each item is shown as "Source: Wikipedia Current events — headline · site · date (CC BY-SA 4.0)" linking to the news report the item cites                                                                                                                                                                                                        |
| GDELT DOC 2.0 API (api.gdeltproject.org)          | Free for any use, including commercial, with a citation to the GDELT Project and a link to https://www.gdeltproject.org/ ([terms](https://www.gdeltproject.org/about.html), checked 2026-11-23). Shown as "Source: GDELT — headline · site · date" linking to the article; Settings names GDELT and its site. Headlines belong to their publishers and are shown as title + link only |
| RSS/Atom feeds the user adds                      | None bundled. The user chooses each feed and is responsible for its terms (many, e.g. BBC's, are personal/non-commercial only). Shown as title + link only                                                                                                                                                                                                                            |

## Libraries

| Component                                                                                                                     | Licence                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Expo, React Native, React                                                                                                     | MIT                                                                     |
| LiteRT-LM (Google AI Edge)                                                                                                    | Apache-2.0                                                              |
| sherpa-onnx                                                                                                                   | Apache-2.0                                                              |
| ONNX Runtime C API headers (vendored in the native module, for photo OCR)                                                     | MIT                                                                     |
| @op-engineering/op-sqlite                                                                                                     | MIT                                                                     |
| SQLCipher (community edition)                                                                                                 | BSD-3-Clause                                                            |
| sqlite-vec                                                                                                                    | MIT / Apache-2.0                                                        |
| OpenSSL (used by SQLCipher)                                                                                                   | Apache-2.0                                                              |
| Apache Commons Compress                                                                                                       | Apache-2.0                                                              |
| AndroidX Core                                                                                                                 | Apache-2.0                                                              |
| AndroidX WorkManager (work-runtime: queued online jobs and network routines with the app closed)                              | Apache-2.0                                                              |
| AndroidX CameraX (camera-core, camera-camera2, camera-lifecycle: live camera memory)                                          | Apache-2.0                                                              |
| Material Symbols "mic" icon (Quick Settings tile)                                                                             | Apache-2.0                                                              |
| expo-symbols, expo-clipboard (chat icons, copy)                                                                               | MIT                                                                     |
| Material Symbols font via @expo-google-fonts/material-symbols (chat icons)                                                    | Apache-2.0 / MIT                                                        |
| expo-camera, expo-speech, expo-secure-store, expo-crypto, expo-sharing, expo-battery                                          | MIT                                                                     |
| expo-notifications, expo-calendar (follow-ups)                                                                                | MIT                                                                     |
| expo-network (online lookup: connection state)                                                                                | MIT                                                                     |
| expo-video, expo-media-library (moment player: play, save to a folder)                                                        | MIT                                                                     |
| expo-asset, expo-font (required by expo-audio and expo-symbols)                                                               | MIT                                                                     |
| expo-audio (playing saved speech clips)                                                                                       | MIT                                                                     |
| expo-haptics (tick on send, cancel, listen)                                                                                   | MIT                                                                     |
| expo-local-authentication (app lock: fingerprint, face or PIN)                                                                | MIT                                                                     |
| expo-application (app version on About and What's new)                                                                        | MIT                                                                     |
| expo-contacts, expo-file-system, expo-calendar (data sources, phone actions)                                                  | MIT                                                                     |
| ZXing core 3.5.3 (QR codes and barcodes, read on the phone)                                                                   | Apache-2.0                                                              |
| UVCAndroid (USB cameras; Java parts from saki4510t/UVCCamera)                                                                 | Apache-2.0                                                              |
| libuvc (inside UVCAndroid)                                                                                                    | BSD-3-Clause                                                            |
| libusb (inside UVCAndroid, separate libusb1.0.so; source: github.com/shiyinghan/UVCAndroid, libuvccamera/src/main/jni/libusb) | LGPL-2.1                                                                |
| libjpeg-turbo (inside UVCAndroid)                                                                                             | IJG / BSD-3-Clause / zlib                                               |
| libyuv (inside UVCAndroid)                                                                                                    | BSD-3-Clause                                                            |
| RapidJSON (inside UVCAndroid, headers)                                                                                        | MIT                                                                     |
| Google Play services Auth (play-services-auth 22.0.0: Gmail sign-in, gmail.send only)                                         | Android Software Development Kit License (free, commercial use allowed) |

This list is updated whenever a dependency is added.

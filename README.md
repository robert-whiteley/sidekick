# Sidekick

A camera and audio assistant that runs entirely on your phone. It sees what you see, hears what you hear (when you let it), remembers it in encrypted on-device memory, and answers questions about your life — with no cloud, no account, no telemetry.

**Status:** Android release in preparation (Google Play). iOS later. Open source under Apache-2.0; provided as is, without support guarantees.

## What it does

- **Ask** — wake word ("Hey Sidekick") or a big button; voice or typed; spoken + streamed text answers about what the camera sees.
- **Capture** — one tap saves a photo (plus optional voice note) with time, place and who was around.
- **Conversations** — optional ambient transcription with automatic speaker separation (no voice enrolment) and consent mode.
- **Memory** — search back years by meaning, person, place or date. Detail questions re-open the original photo and read it again.
- **Follow-ups** — to-dos, events and reminders, never written anywhere without your confirmation.

Everything is optional and off until you turn it on. See [docs/SPEC.md](docs/SPEC.md).

## Platforms

Android first (tested on a Pixel 5, CPU only, 8 GB). iOS (iPhone 13 mini and newer) is planned. Models download on first run (Wi-Fi), from their publishers on Hugging Face and GitHub; nothing goes through any server of ours.

## Development

Requires Node 26 (see `.nvmrc`).

```bash
npm install
npx expo start      # dev server (needs a development build, not Expo Go)
npm run lint
npm run typecheck
npm test
```

Local Android release build (no Android Studio needed beyond the SDK; `android/` is generated):

```bash
npx expo prebuild -p android --no-install
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Cloud builds and Play uploads: `scripts/release.sh` (dry run unless `--real`), see [docs/RELEASE.md](docs/RELEASE.md).

Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · Roadmap: [ROADMAP.md](ROADMAP.md) · Decisions: [docs/decisions](docs/decisions) · Privacy: [PRIVACY.md](PRIVACY.md) · Security: [SECURITY.md](SECURITY.md)

## Licence

Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). Third-party models and libraries keep their own licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Issues and pull requests are welcome ([CONTRIBUTING.md](CONTRIBUTING.md)); there is no guaranteed support. Contact: info@sashy.ai.

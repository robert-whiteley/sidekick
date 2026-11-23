# Sidekick

A camera and audio assistant that runs entirely on your phone. It sees what you see, hears what you hear (when you let it), remembers it in encrypted on-device memory, and answers questions about your life — with no cloud, no account, no telemetry.

**Status:** early development. Not usable yet.

## What it will do

- **Ask** — wake word ("Hey Sidekick") or a big button; voice or typed; spoken + streamed text answers about what the camera sees.
- **Capture** — one tap saves a photo (plus optional voice note) with time, place and who was around.
- **Conversations** — optional ambient transcription with automatic speaker separation (no voice enrolment) and consent mode.
- **Memory** — search back years by meaning, person, place or date. Detail questions re-open the original photo and read it again.
- **Follow-ups** — to-dos, events and reminders, never written anywhere without your confirmation.

Everything is optional and off until you turn it on. See [docs/SPEC.md](docs/SPEC.md).

## Platforms

iOS and Android. Minimum test devices: Pixel 5 (Android 14) and iPhone 13 mini (iOS 26). Works on both, slowly on older phones.

## Development

Requires Node 26 (see `.nvmrc`).

```bash
npm install
npx expo start      # dev server (needs a development build, not Expo Go)
npm run lint
npm run typecheck
npm test
```

Native builds run in the cloud with EAS: `npx eas-cli@latest build --profile development`.

Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · Roadmap: [ROADMAP.md](ROADMAP.md) · Decisions: [docs/decisions](docs/decisions) · Privacy: [PRIVACY.md](PRIVACY.md) · Security: [SECURITY.md](SECURITY.md)

## Licence

Apache-2.0. Third-party models and libraries: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

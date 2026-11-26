# Project rules

Reference only: nothing loads this into AI sessions. Search it when needed. Checkable rules are
enforced by scripts (`scripts/check-privacy.sh` in pre-commit and CI).

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Project rules (Sidekick)

- The repo is public, open source, Apache-2.0: never commit personal data (see owner rules below).
- Start every session by reading `docs/PLAN-v2.md` (all owner decisions for the current phase); tick items there as they land. Also `docs/SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md` and `docs/decisions/` before larger changes. Record anything left out or rejected (with why) in ADR 0006 and check it before proposing ideas.
- Fully on-device: no network by default (except model downloads and the quick-fix check, both switchable), no accounts, no telemetry.
- Commercial-safe licences only; update `THIRD_PARTY_NOTICES.md` with each dependency/model.
- Must work on Pixel 5 (CPU only, 8 GB) and iPhone 13 mini (4 GB): load big models on demand; LLM and embedder stay loaded together only on phones with ≥ 6 GB RAM while Android isn't short of memory, otherwise one unloads first.
- Tests for logic changes. Report what was verified on a device vs only built; verify on the phone before calling work done.
- Distribution: one app, the Google Play build, the same for every user (no direct-APK variant).

## Owner working rules

- The owner doesn't read code: choose on merit, explain in product terms, check checkable facts (licences, prices, support) instead of flagging them.
- Do all the work to completion, in parallel where possible; ask only about money, one-way steps, what users see/keep, or taste. Merge own PRs once CI passes.
- Never pay for anything; alert the owner first. Never delete the owner's files outside the project (phone or PC); report the space needed instead.
- Phone testing: camera/mic use on the test phone is allowed for short test clips, deleted after; never open, read or send anything personal (messages, emails, photos) outside the app.
- No personal data, keys, IPs, emails or device serials in the repo or its history; git email is the GitHub noreply address.
- Answers to the owner: short, plain words, conclusion first, backed by data.
- Claude tooling stays minimal: auto-memory is off for this repo (facts live in these docs); the only hook fast-forwards `main` at session start.

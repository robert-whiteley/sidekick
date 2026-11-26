# Contributing

1. Use Node from `.nvmrc`, then `npm install` (it turns on the commit hook in `.githooks/`).
2. Expo changes every SDK: check the docs for the SDK in `package.json` (`https://docs.expo.dev/versions/v<major>.0.0/`). Prefer Expo modules over third-party libraries.
3. Logic changes need tests. Native changes need a development build and a check on a phone; say what ran on a device and what was only built.
4. Significant decisions get an ADR in `docs/decisions/`; ideas left out or rejected go in ADR 0006 (check it before proposing one).
5. Contributions are accepted under Apache-2.0 (the project's licence).

Checked by scripts, not by hand: commit email (GitHub noreply only), personal data, secrets and
generated `ios/`/`android/` folders (`scripts/check-privacy.sh`, gitleaks), licences and
`THIRD_PARTY_NOTICES.md` (`scripts/check-licences.mjs`), lint, types, tests and formatting (commit
hook and CI), network use (`__tests__/no-network-test.ts`), routes only in `src/app/`. Claude Code
sessions also get `scripts/claude-guard.py` (dependencies via `npx expo install`, no
`--no-verify`, store builds through the release workflow, phone safety via `scripts/phone-lock.sh`
and `scripts/phone-input.sh`).

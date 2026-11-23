# Contributing

1. Use Node from `.nvmrc`, then `npm install` and `git config core.hooksPath .githooks`.
2. Add packages with `npx expo install <pkg>` (picks SDK-compatible versions).
3. Logic changes need tests. Run `npm run lint && npm run typecheck && npm test` before a PR.
4. Never hand-edit `android/` or `ios/` — they are generated; use `app.json` and config plugins.
5. Every new dependency or model must allow commercial use; add it to `THIRD_PARTY_NOTICES.md`. No GPL/AGPL/non-commercial licences.
6. Significant decisions get an ADR in `docs/decisions/`.
7. Never commit secrets, keystores, `.env` files, device IPs/serials or personal email addresses.

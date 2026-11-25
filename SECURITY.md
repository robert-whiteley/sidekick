# Security

## Reporting a vulnerability

Please report privately via GitHub's "Report a vulnerability" (Security → Advisories) on this repository, or email info@sashy.ai. Do not open a public issue.

## Design

- SQLCipher-encrypted database; key in Keystore / Keychain (`expo-secure-store`).
- App data excluded from backups (Android `allowBackup=false` + data extraction rules; iOS `isExcludedFromBackup`).
- No network access by default; model files verified against pinned SHA-256 hashes before use.
- Text from screens, web pages and notifications is treated as untrusted input (prompt injection): it can inform answers but cannot trigger actions; every action needs user confirmation.
- No secrets in the repository; gitleaks runs on every commit and in CI.

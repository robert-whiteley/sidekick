# Privacy

Sidekick is designed so that your data never leaves your phone.

- **No network by default.** The only network use is downloading models (verified by SHA-256) and checking for app updates. Your questions, photos, voice and memory are never sent anywhere.
- **No accounts, telemetry, analytics or ads.** No crash reporting in the MVP; any future crash reporting will be opt-in.
- **Encrypted storage.** Memory is stored in an SQLCipher-encrypted database; the key is kept in the Android Keystore / iOS Keychain.
- **Excluded from cloud backups**, so your memory is not copied to Google or Apple servers.
- **Recording is visible and controllable.** A permanent notification with a Stop button is shown while listening, and Android's mic indicator stays on. Only transcripts are kept, never audio.
- **Location is optional and stays on the phone.** If you allow it, memories get coordinates and a town name looked up from a bundled offline list (GeoNames); Android's own location service is used, with no Google Play services and no online lookups. Deny it and everything else works.
- **Consent mode** (on by default everywhere) keeps other people's speech only after they agree out loud.
- **You own your data.** Export everything, or delete an item, a person, a time range, or all of it at any time.

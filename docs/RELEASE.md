# Releasing Sidekick on Google Play (and the App Store)

One app, `app.ondevice.sidekick`, on Google Play (the iPhone version: section E; plus small over-the-air quick fixes via EAS Update while the user base is small; see D). EAS builds the app bundle in the cloud, and `eas submit` uploads it. fastlane (`fastlane/`) pushes listing text and changelogs and moves releases between tracks. `scripts/release.sh` runs it all. It is a **dry run unless `--real`** is given.

Nothing here costs money. EAS free plan: up to 15 Android cloud builds (expo.dev/pricing, checked 25 Nov 2026; queued, low priority) and EAS Update for up to 1,000 monthly active users (no overage on the free plan: above the limit updates stop being served). When builds run out, build locally (`cd android && ./gradlew bundleRelease`) and upload the `.aab` with fastlane: free at any size. Play is already paid (one-off). OAuth sensitive-scope verification is free.

## A. Owner steps (once, in this order)

1. **Create the app** in Play Console: Create app → name "Sidekick", default language English (United Kingdom), App, Free. Accept the declarations. The package name is set by the first upload.
2. **Closed test, if this account needs it.** Personal developer accounts created after 13 November 2023 need **at least 12 testers opted in continuously for the preceding 14 days** before "Apply for production" unlocks. Google's review usually takes 7 days or less ([Google](https://support.google.com/googleplay/android-developer/answer/14151465), checked 25 Nov 2026). Organisation accounts are exempt. Start this early: it is the longest wait.
   - Test and release → Testing → Closed testing → create the track (name it "Closed testing"; the API calls it `alpha`) → add a Google Group or an email list of 12+ testers → share the opt-in link.
   - Testers must **stay opted in** for 14 days in a row. Anyone who leaves restarts their count.
   - Then Dashboard → Apply for production. You answer questions on how testers were recruited, their feedback and what changed. Tell Claude what testers said, and it drafts the answers.
3. **First upload by hand.** Play's API can't create the first release.
   - Claude runs `scripts/release.sh ship --real` up to the build and gives you the `.aab` download link from EAS. Or the owner runs: `npx eas-cli build -p android --profile production`.
   - In Play Console, Test and release → Testing → Internal testing → Create release → upload that `.aab` → accept **Play App Signing** → save. This fixes the package name.
4. **Give the existing Play service account access to this app.**
   - Play Console → Users and permissions → the service account's email (the one Pocket Animals uses) → App permissions → add Sidekick.
   - Grant: Releases (manage testing tracks, release to production), Store presence (edit listing), App access (view app information).
   - Put its JSON key at `./google-service-account.json` in this repo folder. It is gitignored; never commit it. Pocket Animals' key file can be copied locally, the same account.
5. **Website (privacy policy, support, data deletion).** The site is the public repo `robert-whiteley/sidekick-site`, served free by GitHub Pages at https://robert-whiteley.github.io/sidekick-site. Enter https://robert-whiteley.github.io/sidekick-site/privacy in App content → Privacy policy and in the OAuth consent screen; https://robert-whiteley.github.io/sidekick-site/delete-data where Play asks for a deletion link. `scripts/build-site.mjs` regenerates the site's privacy page from `docs/privacy-policy.md` (the same text as in the app).
6. **Support email: info@sashy.ai.** Already in `app.json` `expo.extra.support.email` (turns on About → Send feedback). Put the same in Play Console → Store settings → Store listing contact details.

7. **Store images.** See `fastlane/IMAGES.md`: icon 512 px, feature graphic 1024 × 500, and 2–8 phone screenshots with test data only.
8. **App content forms.** Claude has written the answers; paste them:
   - Data safety: `docs/store/data-safety.md`
   - Content rating, target audience, ads, app access: `docs/store/content-rating.md`
   - Foreground service declaration and demo video: `docs/store/permissions.md`. The video is unlisted on YouTube, recorded on the phone.
9. **Google OAuth verification**, for Gmail send and Google Tasks: `docs/store/oauth-verification.md`.
   - Add the **Play App Signing SHA-1** (Play Console → App integrity) to the Android OAuth client, or sign-in fails in store installs.
   - Submit the scope justifications and the demo video.
   - Until approved, only listed test users can sign in. The rest of the app is unaffected.

## B. Claude steps (each release)

**Owner rule (26 Nov): store builds only with the owner's OK, and always both stores from the same
commit** (Android AAB to the Play closed test and iOS to TestFlight together, same version), so the
two stores stay in sync. Local test APKs for the phone don't need an OK. A new iOS build in
TestFlight doesn't disturb a version that is in review; only attaching it to that version would.
Changes to native code (or the Expo SDK) need a new store build; JavaScript-only fixes go out as
quick fixes (EAS Update) to builds with the same fingerprint.

1. `scripts/release.sh check`: typecheck, lint and tests; store text lengths; no secret files tracked; legal texts in sync; quick fixes never check automatically (`updates.checkAutomatically` must be `NEVER`; the app checks only when "Get quick fixes" is on).
2. Write plain-words notes (one change per line) and run `scripts/release.sh bump --version 1.0.1 --notes notes.txt --real`. This adds the entry to `src/content/changelog.ts` (shown in the app under What's new, once after the update) and sets `app.json` version. Commit, PR, merge.
3. Verify on the test phone first (preview build or dev build). Report what was checked on the device.
4. `scripts/release.sh ship --real`:
   - runs the checks;
   - builds in the EAS cloud (versionCode auto-increments, remote);
   - `eas submit` uploads to **internal, as a draft**;
   - writes the Play "What's new" (`fastlane/.../changelogs/<versionCode>.txt`) and attaches it.

   Use `--track alpha` to submit straight to closed testing.

5. Owner (or Claude, when asked) rolls out the draft in Play Console. Or promote:
   - `scripts/release.sh promote --from internal --to alpha --real` (closed test)
   - `scripts/release.sh promote --from alpha --to production --rollout 0.2 --real` (20% staged), then `--rollout 1`.
6. Listing text changes: edit `fastlane/metadata/android/en-GB/*.txt`, run `node scripts/check-store-text.mjs`, then `scripts/release.sh metadata --real`. Add `--images` once the images exist.

Rules: never publish to production without the owner's go-ahead. Never pay. Never commit `google-service-account.json`, keystores or `.env`. fastlane needs Ruby and `bundle install` once (`Gemfile`).

## E. iPhone (App Store)

The same app for iPhone, bundle ID `app.ondevice.sidekick`, App Store Connect Apple ID `6838426860`
(`eas.json` → `submit.production.ios.ascAppId`). The App Store Connect record (name "Sidekick –
On-device AI", version 1.0) exists, and EAS holds the iOS distribution certificate, provisioning
profile and App Store Connect API key, so build and upload run without prompts. No Mac is needed.
Listing texts and form answers: `docs/store/app-store.md`; owner clicks: `docs/RELEASE-OWNER-STEPS.md`
section 10.

- Build: `npx eas-cli build -p ios --profile production` (cloud; EAS free plan, low-priority queue).
  The build number goes up by itself (`autoIncrement`, remote version source).
- Upload to TestFlight: `npx eas-cli submit -p ios --profile production --latest`. TestFlight
  processing takes 10–30 minutes; then the owner installs it.
- Quick fixes: `scripts/release.sh update` publishes to both platforms; an update reaches an iPhone
  build only if its runtime version (native fingerprint) matches.
- Native side: `modules/sidekick-native/ios/` (Swift). `pod install` on the EAS machine downloads the
  LiteRT-LM xcframework (pinned SHA-256) into `modules/sidekick-native/ios/vendor/` and bundles the place list (both gitignored).
  `ios/` is generated (prebuild); never commit it.
- Not in China mainland (Pricing and Availability); see ADR 0006.
- iPhone screenshots: `node scripts/iphone-screenshots.mjs <folder>` turns iPhone 13 mini screenshots
  into the 6.5" size (1284 × 2778 JPEG).

**Review submission** (attach the newest build and submit): `node scripts/asc-submit.mjs` with the team's
App Store Connect API key. On the laptop: `ASC_ENV_FILE=~/pocket_animals/frontend/fastlane/.env` (the key
Pocket Animals uses). From a cloud session this needs GitHub secrets `ASC_KEY_ID`, `ASC_ISSUER_ID` and
`ASC_KEY_P8` added by the owner; until then submit from the laptop. Content rights are set on the app (no
third-party content). An empty extra draft submission sits in App Store Connect; harmless.

## D. Quick fixes (EAS Update)

- For JS/asset-only fixes: `scripts/release.sh update --notes notes.txt --real` (channel `production`; `--channel preview` for test builds). Native changes (Kotlin, new native packages, app.json plugins/permissions) need `ship`: the runtime version is the native fingerprint, so an update only reaches builds it is compatible with.
- In the app: Settings → Advanced → **Get quick fixes** (on, Recommended). Checks only on Wi-Fi, at most every 6 h; a downloaded fix applies on the next cold start (never mid-use). Off = Sidekick never contacts Expo. The request carries runtime version, platform, channel and current update id; Expo sees the IP (privacy policy item 6).
- **At ~800 monthly users** (Play Console → Statistics → monthly active users), act before the free 1,000-MAU limit: either switch the default to off and ship fixes as Play builds only (free at any size; owner's long-term plan), or self-host the update server: **expo-open-ota** (github.com/axelmarciano/expo-open-ota: MIT except its `ee/` enterprise folders, which are not needed; active, last push 23 Nov 2026; implements the Expo Updates protocol, runs on free hosting with S3-compatible storage) and point `updates.url` at it in the next build. Expo itself (the SDK, MIT) stays free; only EAS cloud services have paid tiers, and none is required.

## C. Known issues before launch

- **Saving to the gallery** now runs without READ_MEDIA permissions (blocked for Play's photo policy). Check Save in the moment player on the phone.
- **CALL_PHONE** is now declared. Check "call Sam" on the phone.
- **Background playback** of saved clips is off (no mediaPlayback service). Clips stop if the app is left.

## Releasing from any session (cloud or laptop)

Future sessions run in the cloud, which has no local key files and no phone. Everything that ships
goes through GitHub Actions instead, so it works the same from the cloud or the laptop:

- **Store builds and uploads:** `gh workflow run release.yml -f platform=all -f track=alpha`
  (`.github/workflows/release.yml`): EAS builds Android and iOS, uploads the AAB to Play (track
  `alpha` = closed test; `internal`, `beta`, `store` = production only after the owner's go) and the
  iOS build to TestFlight. Watch with `gh run watch`.
- **Quick fixes (OTA):** every merge to `main` publishes an EAS update to the `preview` channel (CI).
  Promote with `eas update:republish --channel production` (needs `EXPO_TOKEN`; run it through a
  workflow from the cloud).
- **Secrets (GitHub → Settings → Secrets → Actions):** `EXPO_TOKEN` (set) and
  `GOOGLE_SERVICE_ACCOUNT_JSON` (the Play upload key, the same one Pocket Animals uses; the owner adds
  it once with
  `gh secret set GOOGLE_SERVICE_ACCOUNT_JSON -R robert-whiteley/sidekick < ~/pocket_animals/frontend/google-service-account.json`).
  iOS signing and the App Store Connect upload key live on EAS (set up with `eas credentials -p ios`,
  26 Nov), so nothing for iOS is needed in GitHub.
- **Play release status:** Play only accepts draft releases until the app's first review passes;
  `eas.json` uses `releaseStatus: draft`, so after each upload roll the draft out in Play Console
  (Closed testing → Edit release → Start rollout). Once the app is approved, switch `closed` to
  `completed` so uploads reach testers without a click.
- **Phone testing** needs the laptop (adb over Wi-Fi to the Pixel 5; `scripts/phone.sh`). The cloud
  can build and ship but can't test on a phone.

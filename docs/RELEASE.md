# Releasing Sidekick on Google Play

One app, `app.ondevice.sidekick`, on Google Play only. EAS builds the app bundle in the cloud, and `eas submit` uploads it. fastlane (`fastlane/`) pushes listing text and changelogs and moves releases between tracks. `scripts/release.sh` runs it all. It is a **dry run unless `--real`** is given.

Nothing here costs money. EAS free tier: cloud builds are queued, about 30 Android builds a month. Play is already paid (one-off). OAuth sensitive-scope verification is free.

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
5. **Host the privacy policy at a public URL.** Use `docs/privacy-policy.md`, the same text as in the app. A free option: a public GitHub Pages site or Google Sites page with only this text. **This repo should stay private**, and it is currently public; see note C. Enter the URL in App content → Privacy policy, and in the OAuth consent screen.
6. **Support email.** Create a contact address for the listing (Play shows it publicly), e.g. a new free mailbox. Put it in:
   - Play Console → Store settings → Store listing contact details;
   - `app.json` `expo.extra.support.email`, which turns on About → Send feedback.

   Do not use a personal address.

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

1. `scripts/release.sh check`: typecheck, lint and tests; store text lengths; no secret files tracked; legal texts in sync; `updates.checkAutomatically: "NEVER"`.
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

## C. Known issues before launch

- **The GitHub repo is public** (`gh repo view` reports PUBLIC); the owner rule is private. Making it private breaks the Speed test photo download (`src/engine/models.ts` `benchPhoto` points at raw.githubusercontent.com in this repo). Bundle that photo, or hide the Speed test, first.
- **Saving to the gallery** now runs without READ_MEDIA permissions (blocked for Play's photo policy). Check Save in the moment player on the phone.
- **Drive backup** has a switch but nothing calls `backupToDrive()` yet.
- **CALL_PHONE** is now declared. Check "call Sam" on the phone.
- **Background playback** of saved clips is off (no mediaPlayback service). Clips stop if the app is left.

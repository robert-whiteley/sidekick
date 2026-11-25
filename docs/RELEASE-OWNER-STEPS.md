# Owner steps (the complete list, in order)

Everything else is done by Claude (`docs/RELEASE.md`). None of these cost money. Tick each one off here.

## 1. Website: https://sidekick.sashy.ai (2 minutes)

The site (`robert-whiteley/sidekick-site`, public) is already published by GitHub Pages. It only needs the address:

- [ ] Namecheap (sashy.ai's DNS host) → Domain List → sashy.ai → **Advanced DNS** → Add New Record → **CNAME**, Host `sidekick`, Value `robert-whiteley.github.io.` → save.
- Claude then turns on HTTPS in GitHub Pages and checks https://sidekick.sashy.ai/privacy (the certificate can take up to an hour).

## 2. Verify sashy.ai with Google (needed for Google sign-in approval)

- [ ] https://search.google.com/search-console → Add property → **Domain** → `sashy.ai` → copy the TXT record → Namecheap → Advanced DNS → Add New Record → **TXT**, Host `@`, Value the copied text → back in Search Console → Verify. Use the same Google account as the Google Cloud project.

## 3. Play Console

- [ ] **Create app**: name "Sidekick", English (United Kingdom), App, Free. Accept the declarations.
- [ ] **First upload by hand** (Claude gives you the `.aab`): Test and release → Testing → Internal testing → Create release → upload → accept **Play App Signing** → Save → Roll out to internal testing.
- [ ] **Service account access**: Users and permissions → the service account Pocket Animals uses → App permissions → add Sidekick → Releases, Store presence, App access. Claude does every later upload and listing change.
- [ ] **Closed test, only if Play asks** (personal accounts made after Nov 2023): Testing → Closed testing → 12+ testers → share the opt-in link → they stay opted in 14 days → Dashboard → Apply for production (Claude drafts the answers).
- [ ] **Store listing contact details**: email `info@sashy.ai`, website `https://sidekick.sashy.ai`. Listing language: English (United Kingdom).
- [ ] **App content** (Claude has written every answer; paste them):
  - Privacy policy: `https://sidekick.sashy.ai/privacy`; data deletion link if asked: `https://sidekick.sashy.ai/delete-data`.
  - Data safety: `docs/store/data-safety.md`.
  - Content rating, target audience, ads, app access: `docs/store/content-rating.md`.
  - **Foreground service types** (`docs/store/permissions.md`): camera, microphone, location (the listening/camera service), and shortService (routines running with the app closed). Each needs a one-line use and a short phone video (Claude records the clips' script; you upload unlisted to YouTube).
  - **Health apps declaration**: step counting (activity recognition) — declare "fitness / activity tracking is a feature, data stays on the device".
  - **SMS and Call Log permissions declaration** (default-assistant exception) — **for the second release, not the first** (owner decision 25 Nov: launch without). The feature is built; release 1 blocks READ_SMS, SEND_SMS and READ_CALL_LOG in `app.json` (`blockedPermissions`) and the app hides it. For release 2: remove those three from `blockedPermissions`, submit the form with the answers and video script in `docs/store/permissions-declaration.md`, wait for approval.
  - Background location: not used (no declaration needed). Only if it is ever added.
- [ ] **Store images**: Claude makes them (`fastlane/IMAGES.md`); nothing to do unless you want to approve them.

## 4. Second Google sign-in client (after the first upload)

- [ ] Play Console → Test and release → **App integrity** → App signing → copy the **SHA-1** of the app signing key.
- [ ] Google Cloud Console (Sidekick project) → Google Auth Platform → Clients → **Create client** → Android → package `app.ondevice.sidekick` → paste the SHA-1 → Create. Keep the existing client too. Without it, Gmail / Tasks / Drive sign-in fails in the Play-installed app.

## 5. Google sign-in approval (Gmail send, Tasks, Drive backup)

- [ ] Google Auth Platform → **Branding**: support email `info@sashy.ai`, home page `https://sidekick.sashy.ai`, privacy policy `https://sidekick.sashy.ai/privacy`, authorised domain `sashy.ai`, logo (Claude provides it).
- [ ] **Data access**: scopes `gmail.send`, `tasks`, `drive.file`.
- [ ] Record the demo video on the phone (script: `docs/store/oauth-verification.md`, about 3 minutes, test account and made-up contact only) → YouTube **Unlisted**.
- [ ] **Audience → Publish app**, then **Verification centre → Submit** with the justifications from `docs/store/oauth-verification.md` and the video link. Answer Google's emails.

Until Google approves, only listed test users can use the Google features; the rest of the app works for everyone.

## 6. Quick fixes (EAS Update)

- Already linked: the Expo project is set in `app.json` (`extra.eas.projectId`, owner account). Nothing to do unless `npx eas-cli whoami` on this PC says you are logged out — then run `npx eas-cli login` once.
- [ ] Later, at ~800 monthly users (Play Console → Statistics): tell Claude, to switch quick fixes off by default or self-host them (see `docs/RELEASE.md` D). Free up to 1,000 monthly users; never paid without asking you.

## 7. Each release

- [ ] Say "go" for production. Claude never publishes to production without it.

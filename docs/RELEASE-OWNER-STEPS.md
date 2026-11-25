# Owner steps to launch (in order)

Everything else is done by Claude (`docs/RELEASE.md`). None of these cost money.

## 1. Website: https://sidekick.sashy.ai (about 5 minutes)

1. Render dashboard → **New → Static Site** → connect GitHub repo `robert-whiteley/sidekick-site` (private; allow Render access to it if asked).
   - Branch `main`, Build command: leave empty, Publish directory: `.` → Create. (Or **New → Blueprint** and pick the repo: `render.yaml` sets this up.)
2. The site → Settings → **Custom Domains → Add** `sidekick.sashy.ai`. Render shows a CNAME target (like `sidekick-site.onrender.com`).
3. At the DNS host for sashy.ai: add a **CNAME** record, name `sidekick`, value the target from step 2. Back in Render, press Verify; HTTPS turns on by itself.
4. Check https://sidekick.sashy.ai/privacy opens.

## 2. Verify sashy.ai with Google (needed for Gmail sign-in approval)

1. https://search.google.com/search-console → Add property → **Domain** → `sashy.ai`.
2. Add the TXT record it shows at the DNS host → Verify. Use the same Google account as the Google Cloud project.

## 3. Play Console

1. **Create app**: name "Sidekick", English (United Kingdom), App, Free. Accept the declarations.
2. **First upload by hand** (Claude gives you the `.aab` file): Test and release → Testing → Internal testing → Create release → upload → accept Play App Signing → Save → Roll out to internal testing.
3. **Give the service account access**: Users and permissions → the service account Pocket Animals uses → App permissions → add Sidekick → Releases, Store presence, App access. Claude then does all later uploads and listing text.
4. **Closed test, only if Play asks for it** (personal accounts made after Nov 2023): Testing → Closed testing → add 12+ testers' emails → share the opt-in link. They must stay opted in 14 days, then Dashboard → Apply for production.
5. **Store settings → Store listing contact details**: email `info@sashy.ai`, website `https://sidekick.sashy.ai`.
6. **App content**: Privacy policy `https://sidekick.sashy.ai/privacy`. Paste Claude's answers for Data safety (`docs/store/data-safety.md`), content rating and the rest (`docs/store/content-rating.md`), and the foreground service declaration (`docs/store/permissions.md`). Data deletion link if asked: `https://sidekick.sashy.ai/delete-data`.

## 4. Second Google sign-in client (after step 3.2)

1. Play Console → Test and release → **App integrity** → App signing → copy the **SHA-1** of the app signing key.
2. Google Cloud Console (the Sidekick project) → Google Auth Platform → Clients → **Create client** → Android → package `app.ondevice.sidekick` → paste that SHA-1 → Create. (Keep the existing one too.)
   Without this, Gmail / Tasks / Drive sign-in fails in the Play-installed app.

## 5. Google sign-in approval (Gmail send, Tasks, Drive backup)

1. Google Auth Platform → **Branding**: support email `info@sashy.ai`, home page `https://sidekick.sashy.ai`, privacy policy `https://sidekick.sashy.ai/privacy`, authorised domain `sashy.ai`, app logo (Claude provides it).
2. **Data access**: scopes `gmail.send`, `tasks`, `drive.file`.
3. Record the demo video on the phone (script: `docs/store/oauth-verification.md`, about 3 minutes, test account and made-up contact only), upload to YouTube as **Unlisted**.
4. **Audience → Publish app**, then **Verification centre → Submit**: paste the justifications from `docs/store/oauth-verification.md` and the video link. Answer Google's emails (they go to your developer contact address).

Until Google approves, only your listed test users can sign in to Google features; the rest of the app works for everyone.

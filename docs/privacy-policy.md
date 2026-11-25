# Sidekick privacy policy

Last updated: 25 November 2026

Sidekick is an AI helper that runs entirely on your phone. This policy explains what it does with your information. In short: **we don't collect anything.** There are no accounts, no analytics, no ads and no tracking, and we have no servers that receive your data.

## What stays on your phone

Everything Sidekick sees, hears and remembers stays on your phone:

- What you ask, and the answers.
- Photos, video and audio from the camera and microphone, and the transcripts and notes made from them.
- People, places, to-dos, reminders and facts it remembers.
- Contacts, calendar events and notifications it reads, if you allow it.

All of this is processed on the phone by AI models that run on the phone. The memory database is encrypted, with its key kept in the phone's secure key store. Location, if you allow it, is turned into a town name using a list built into the app, with no online lookup. Sidekick turns off Android's automatic cloud backup, so this data is not copied to Google's backup either.

You can see and delete any of it in the app (Memory, Storage and Privacy settings). You can export everything to a file. Uninstalling Sidekick deletes all of it.

## When Sidekick uses the internet

Sidekick works offline. It connects to the internet only in these cases:

1. **Downloading its AI models.** On first run, and later when a better model for your phone is available (by default only on Wi-Fi while charging; you can switch this off), Sidekick downloads model files from Hugging Face (huggingface.co) and GitHub (github.com, raw.githubusercontent.com). These are plain file downloads: nothing about you is sent. Like any website, those services can see your phone's IP address.
2. **Online lookup — off unless you turn it on.** When it is on and a general question needs the web, a few search words for it (written on the phone, with the names of people you know taken out) are sent to Wikipedia and DuckDuckGo, and to a SearXNG server if you set one up. For news questions they also go to GDELT (api.gdeltproject.org), and Sidekick downloads Wikipedia's current-events pages and any news feeds you added (these downloads send no question words). Nothing else is sent: no memory, photos, voice, location, contacts or identifiers. Those services see your IP address and the search words, under their own privacy policies.
3. **Google features — off unless you turn them on.** If you sign in with Google for a feature, your phone talks directly to Google; nothing goes through us:
   - **Email:** sends an email you have approved, using Gmail (permission to send only; Sidekick cannot read your mail).
   - **Google Tasks:** keeps your Sidekick to-dos and Google Tasks in step.
   - **Google Drive backup:** uploads your exported backup file to your Drive. Sidekick can only see files it created.

   Google's privacy policy applies to that data. You can turn each feature off in Settings, and remove Sidekick's access at myaccount.google.com/permissions. Sidekick's use of information received from Google APIs follows the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

4. **Links and apps you open.** When you tap a link, or send a message through another app (such as Messages or WhatsApp), that app or website handles it under its own policy.

App updates come only through Google Play.

## Camera, microphone and other permissions

Sidekick asks for each permission when you first use the feature that needs it. You can refuse or withdraw it in the app's Settings or in Android settings. The camera and microphone are only used while you have listening or the camera turned on, and Android shows its indicator whenever they are in use. Consent mode, which is on by default where the law requires everyone's agreement to record, keeps nothing of voices that haven't agreed.

## Children

Sidekick is not directed at children under 13 and does not knowingly collect information from anyone. Since nothing leaves the phone, nothing is collected from children either.

## Changes

If this policy changes, the new version will be posted at the same address, with a new date at the top, and mentioned in the app's "What's new".

## Contact

Questions? Use **Settings → About → Send feedback** in the app, or the contact email on Sidekick's Google Play page.

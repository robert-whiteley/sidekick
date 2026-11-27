# App Review screen recording (iPhone)

Apple asked for a screen recording made on a real iPhone running the latest iOS, starting from app launch and showing the main features. About 2 to 3 minutes, plus the download.

## Before you start

- Update the iPhone to the latest iOS (Settings → General → Software Update).
- Install the newest Sidekick build from TestFlight (the one attached to version 1.0).
- To show the first run, delete Sidekick and install it again from TestFlight. This downloads the 3 GB model again, so use Wi-Fi.
- Leave out the camera and picture features for now (they are being fixed on iPhone); the review notes describe only what this list shows.
- Turn on Do Not Disturb so no notifications appear. Use made-up examples only: no real names, places, messages or photos of people.
- Add Screen Recording to Control Centre if it isn't there: open Control Centre, press and hold an empty space, tap **Add a Control**, choose **Screen Recording**.
- Optional: in Control Centre, press and hold Screen Recording and turn **Microphone** on, so your spoken question is heard.

## Recording

Open Control Centre, tap **Screen Recording**, wait for the 3-second countdown, then close Control Centre. To stop, tap the red indicator at the top of the screen, then **Stop**. The video goes to Photos.

## Shot list (in order)

1. **Launch.** From the Home Screen, tap Sidekick.
2. **First run.** Show the space check and the download starting by itself on Wi-Fi, and the explainer. The download takes about 5 to 10 minutes; you can keep recording through it, or cut the middle later (see below). When it finishes, the chat opens with example questions.
3. **Typed question.** Tap one example question, or type "What can you do?" and send. Let the answer finish.
4. **Voice.** Hold the mic button, say "What's a good name for a cat?", let go. Show the answer being written and spoken.
5. **Memory.** Type "I parked on level 3, space 42" and send. Then ask "Where did I park?" and show the answer.
6. **No shared content.** Open Settings (gear icon) → Assistant and show the Make pictures row: "Not on iPhone yet". Sidekick has no accounts and nothing is shared with other users, so there is no reporting or blocking to show. (The picture Report button exists only on Android.)
7. **Privacy and data.** Settings → Privacy: show Online lookup is off. Tap **Export everything** and show the share sheet, then close it. Tap **Delete everything** and show the confirmation; tap Cancel (or Delete, if you don't mind losing the test data).
8. Stop the recording.

## Cutting the download (optional)

Photos can only trim the start and end. To remove the middle of the download, use iMovie (free from Apple): new Movie, add the recording, split the clip before and after the waiting part and delete it. Say in the video or leave a short title such as "download shortened".

## Sharing the link

Either:

- **YouTube** (like the Play video): in the YouTube app tap **+** → Upload a video, pick the recording, set **Visibility: Unlisted**, upload, then Share → Copy link.
- **iCloud**: in Photos open the video, tap Share → **Copy iCloud Link**.

Send the link, then the resubmission is one command:

```
ASC_ENV_FILE=~/pocket_animals/frontend/fastlane/.env node scripts/asc-submit.mjs --video <link> --build <TestFlight build number you recorded on>
```

It puts the link in the App Review notes (docs/store/app-review-notes.txt), attaches that build (without `--build`: the newest processed one) and resubmits version 1.0.

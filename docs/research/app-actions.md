# Doing things inside other apps (Perplexity, Gemini) — what Sidekick can do

Research 25 Nov 2026.

## How the others do it

- **Perplexity Assistant (Android, Jan 2025):** books rides, plays songs, drafts emails, sets
  reminders. Perplexity has not said how; press coverage shows it opening the target app with the
  task filled in (deep links / intents) and the user finishing there. Its CEO said some actions
  "might not always work". No source found saying it uses an Accessibility service.
  ([TechCrunch](https://techcrunch.com/2025/01/23/perplexity-launches-an-assistant-for-android),
  [Android Authority](https://androidauthority.com/perplexity-assistant-android-3519824))
- **Perplexity Comet (Android browser, Nov 2025):** its agent acts _inside web pages_ in its own
  browser (Gmail, Calendar on the web), user can watch and step in.
  ([TechCrunch, 20 Nov 2025](https://www.techcrunch.com/2025/11/20/perplexity-brings-its-ai-browser-comet-to-android/))
- **Gemini:** Google "extensions" into its own apps (server side), plus **AppFunctions** and a
  "UI automation" platform on Android 16+, in early beta on Galaxy S26, wider with Android 17.

## AppFunctions (Android 16+)

- Apps expose functions ("create task", "create playlist"); a caller with
  `android.permission.EXECUTE_APP_FUNCTIONS` (protection level _normal_) runs them. But the platform
  enforces an **allowlist at runtime**, and during the experimental phase "only a limited number of
  apps and system agents can access the entire pipeline"; agent apps are registered after being
  granted system-privileged permissions. There is an Early Access Program sign-up; signing up does
  not grant access. ([Manifest.permission](https://developer.android.com/reference/android/Manifest.permission),
  [AppFunctions overview, updated 16 Nov 2026](https://developer.android.com/ai/appfunctions),
  [Android Developers Blog, Jul 2026](https://android-developers.googleblog.com/2026/07/build-intelligent-android-apps-appfunctions.html))
- **For Sidekick:** not usable today even as the default assistant. Worth registering interest in the
  EAP (free); revisit with Android 17.

## Play's Accessibility rule (current text)

> "Any use of the Accessibility API that enables an app to autonomously initiate, plan, and execute
> actions or decisions is strictly prohibited. This does not prohibit deterministic, rule-based
> automation … ("If Trigger X occurs, perform Action Y")."

Verified accessibility tools (`isAccessibilityTool="true"`) are exempt only for helping people with
disabilities. Every Accessibility app also needs Google's declaration form and a video.
([Play policy](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en))

So an AI that reads the screen and decides which buttons to press is banned. A fixed, user-defined
rule ("after I approve, press Send in WhatsApp") is arguably rule-based, but it is a grey zone, still
needs Google's approval, and Sidekick's owner chose one simple Play app (ADR 0006). Keep it out.

## What Sidekick can legally do (Play app, default assistant)

1. Open any app at the right screen with the details filled in (deep links / standard intents); the
   user confirms there. This is what Perplexity appears to do.
2. Do things itself where Android or a service gives an API: calendar, alarms/timers, contacts,
   calls (CALL_PHONE), media control, torch/volume/DND, notification replies, Gmail/Tasks/Drive.
3. Use the system assist features it already has as default assistant (screenshot of the current
   screen, assist gesture, lock-screen entry).
4. Not: tapping inside other apps (Accessibility), AppFunctions (allow-listed), SEND_SMS (default SMS
   app only).

## Deep links and intents

"Vendor doc" = in the app maker's or Android's docs; "Uber verified" checked this session; the rest
are widely used formats not re-checked this session — test each on the phone before shipping.

| App                                   | Task                               | Format                                                                                                                                                                                                                                          | Source                                                                                                                |
| ------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Uber                                  | ride to a place                    | `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=LAT&dropoff[longitude]=LON&dropoff[nickname]=NAME&dropoff[formatted_address]=ADDR` (needs nickname or address for the app to show it; coordinates are what count) | vendor doc, verified ([Uber](https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction)) |
| Lyft (US/CA)                          | ride                               | `lyft://ridetype?id=lyft&destination[latitude]=LAT&destination[longitude]=LON`                                                                                                                                                                  | vendor doc (not re-checked)                                                                                           |
| Bolt                                  | ride                               | no public deep-link spec found; open app (`ee.mtakso.client`)                                                                                                                                                                                   | unverified                                                                                                            |
| Google Maps                           | navigate                           | `google.navigation:q=DEST&mode=d` (d drive, w walk, b bike, l two-wheeler)                                                                                                                                                                      | vendor doc                                                                                                            |
| Google Maps                           | search / directions (any maps app) | `geo:0,0?q=QUERY`; `https://www.google.com/maps/dir/?api=1&destination=DEST&travelmode=driving`                                                                                                                                                 | vendor doc                                                                                                            |
| Waze                                  | navigate                           | `https://waze.com/ul?q=DEST&navigate=yes` or `…?ll=LAT,LON&navigate=yes`                                                                                                                                                                        | vendor doc                                                                                                            |
| Spotify                               | play                               | `MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH` + `query`, package `com.spotify.music`; search screen `spotify:search:QUERY`                                                                                                                  | Android doc + widely used                                                                                             |
| YouTube                               | search / video                     | `https://www.youtube.com/results?search_query=Q` with package `com.google.android.youtube`; `vnd.youtube:VIDEO_ID`                                                                                                                              | widely used                                                                                                           |
| YouTube Music                         | play / search                      | play-from-search intent, package `com.google.android.apps.youtube.music`; `https://music.youtube.com/search?q=Q`                                                                                                                                | widely used                                                                                                           |
| Netflix                               | search                             | `https://www.netflix.com/search?q=Q` (app link; may open the browser)                                                                                                                                                                           | unverified                                                                                                            |
| Amazon                                | product search                     | `https://www.amazon.co.uk/s?k=Q` (app link to `com.amazon.mShop.android.shopping`)                                                                                                                                                              | unverified                                                                                                            |
| WhatsApp                              | new message                        | `https://wa.me/NUMBER?text=URLENCODED` (international number, no +)                                                                                                                                                                             | vendor doc                                                                                                            |
| Telegram                              | message / share                    | `tg://resolve?domain=USERNAME`; `tg://msg?text=TEXT`                                                                                                                                                                                            | widely used                                                                                                           |
| Signal                                | chat                               | `sgnl://signal.me/#p/+NUMBER`                                                                                                                                                                                                                   | unverified                                                                                                            |
| SMS app                               | draft                              | `smsto:NUMBER` + extra `sms_body`                                                                                                                                                                                                               | Android doc                                                                                                           |
| Gmail / any mail                      | draft                              | `ACTION_SENDTO` `mailto:ADDR?subject=S&body=B` (package `com.google.android.gm` to force Gmail)                                                                                                                                                 | Android doc                                                                                                           |
| Calendar                              | add event (UI)                     | `ACTION_INSERT` on `CalendarContract.Events.CONTENT_URI` with title/begin/end extras                                                                                                                                                            | Android doc                                                                                                           |
| Keep / notes                          | new note                           | `ACTION_SEND` text/plain, package `com.google.android.keep`; or `com.google.android.gms.actions.CREATE_NOTE`                                                                                                                                    | Android doc / widely used                                                                                             |
| Chrome / browser                      | open page                          | `ACTION_VIEW https://…` (package `com.android.chrome` optional)                                                                                                                                                                                 | Android doc                                                                                                           |
| Play Store                            | app page / search                  | `market://details?id=PKG`, `market://search?q=Q`                                                                                                                                                                                                | vendor doc                                                                                                            |
| Alarms / timers                       | set                                | `AlarmClock.ACTION_SET_ALARM` / `ACTION_SET_TIMER` (`EXTRA_SKIP_UI`)                                                                                                                                                                            | Android doc                                                                                                           |
| Phone                                 | call                               | `tel:NUMBER` with `ACTION_CALL` (permission) or `ACTION_DIAL`                                                                                                                                                                                   | Android doc                                                                                                           |
| Food (Deliveroo, Uber Eats, Just Eat) | open restaurant search             | open app / web search; no stable public deep links found                                                                                                                                                                                        | unverified                                                                                                            |

Checking an app is installed needs a `<queries>` entry per package (not QUERY_ALL_PACKAGES).

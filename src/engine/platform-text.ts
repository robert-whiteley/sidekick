import { Platform } from 'react-native';

/**
 * Texts that differ between Android and iPhone, in one place. The iPhone app has no background
 * listening, wake word, live camera, routines, notification reading or Google sign-in (ADR 0006
 * "iPhone"), and uses Apple's names (Face ID, passcode, Photos, App Store). Screens and replies
 * take their wording from here instead of repeating `Platform.OS` checks around strings.
 * __tests__/ios-wording-test.tsx checks every iPhone text here, the iPhone settings screens, the
 * iPhone prompt and replies for Android-only words (ANDROID_ONLY_WORDS).
 */

export type Os = 'android' | 'ios';

export const currentOs = (): Os => (Platform.OS === 'ios' ? 'ios' : 'android');
export const onIphone = (): boolean => Platform.OS === 'ios';

/** Words that mean nothing (or the wrong thing) to someone using the iPhone app. */
export const ANDROID_ONLY_WORDS =
  /\b(android|google play|play store|pixel|quick settings|tiles?|widgets?|notification shade|notification access|google assistant|fingerprint|PIN|foreground service|wake word|hey sidekick|home button|usb)\b|pictures\/|downloads\/|movies\//i;

type Pair = { android: string; ios: string };

const TEXTS = {
  // Settings home
  settingsAssistantHint: {
    android: 'Voice, model, wake word, follow-ups',
    ios: 'Voice, model, follow-ups',
  },
  settingsCameraHint: {
    android: 'Inputs and outputs, frame rate, how long video is kept',
    ios: 'Photos you ask about',
  },
  settingsConnectionsHint: {
    android: 'Calendar, messages, email and other apps',
    ios: 'Calendar, contacts, maps and your data sources',
  },
  settingsPrivacyHint: {
    android: 'Recording consent, pause places, online lookup, export, delete',
    ios: 'App lock, location, quiet hours, online lookup, export, delete',
  },
  settingsAdvancedHint: {
    android: 'Storage reserve, downloads, AI chip',
    ios: 'Storage reserve, downloads',
  },
  quickFixesHint: {
    android:
      'Small fixes arrive without a Play Store update, on Wi-Fi only. Off: Sidekick never contacts Expo, the update service; fixes come with Play Store updates.',
    ios: 'Small fixes arrive without an App Store update, on Wi-Fi only. Off: Sidekick never contacts Expo, the update service; fixes come with App Store updates.',
  },

  // Privacy → App lock
  appLockHint: {
    android:
      'Asks for your fingerprint, face or phone PIN to open Sidekick. Spoken answers while the screen is off still need the phone unlocked for anything personal.',
    ios: 'Asks for Face ID or your iPhone passcode to open Sidekick.',
  },
  appLockUnavailable: {
    android:
      'Not possible on this phone: it has no screen lock. Set one in the phone’s Settings → Security first.',
    ios: 'Not possible on this iPhone: it has no passcode. Set one in Settings → Face ID & Passcode first.',
  },
  appLockSetUpFirst: {
    android: 'Set a screen lock on the phone first (Settings → Security).',
    ios: 'Set a passcode on the iPhone first (Settings → Face ID & Passcode).',
  },
  appLockFeature: {
    android: 'App lock (fingerprint, face or PIN)',
    ios: 'App lock (Face ID or passcode)',
  },

  // Privacy → Location, and location answers
  locationHint: {
    android:
      'While Sidekick is listening or open, it notes where the phone is (every few minutes, ' +
      'after moving) so you can ask "where was I at 3?", "where did I park?" or "how long ' +
      'was I at work?". Stays on this phone, encrypted.',
    ios:
      'While Sidekick is open, it notes where the phone is (every few minutes, after moving) so ' +
      'you can ask "where was I at 3?" or "how long was I at work?". iPhone apps can’t note it ' +
      'while closed. Stays on this phone, encrypted.',
  },
  locationNotRecorded: {
    android:
      "I don't know: your location is only remembered while Sidekick is listening or open, with location allowed.",
    ios: "I don't know: on iPhone your location is only remembered while Sidekick is open, with location allowed.",
  },
  parkingUnknown: {
    android:
      "I don't know where you parked. I mark the spot when your car's Bluetooth disconnects while Sidekick is listening.",
    ios: "I don't know where you parked: on iPhone I only note where you are while Sidekick is open.",
  },

  // Assistant → Hands-free
  quietSpeechHint: {
    android:
      'No speaking out loud from {start} to {end} or in Do Not Disturb. Headphones and the car still get answers. Times: Privacy › Auto-pause.',
    ios: 'No speaking out loud from {start} to {end}. Times: Privacy › Quiet hours.',
  },
  readBackHint: {
    android:
      'Says what it is about to send ("Text to Sam: running late. Send it?") and listens for yes, no, "change it to …" or "add …". The countdown starts after.',
    ios: 'Says what it is about to add ("Add lunch with Jo, tomorrow at 1pm, to your calendar?") before the countdown starts.',
  },
  handsFreeHint: {
    android:
      "Spoken answers, read-back and bigger buttons. Automatic: when the car's Bluetooth connects or you ask with the headset button.",
    ios: 'Spoken answers, read-back and bigger buttons. iPhone apps can’t tell when you’re driving, so choose Always on for the car.',
  },

  // Connections → Sending
  sendingLabel: {
    android: 'Messages, emails, events and calls',
    ios: 'Adding calendar events',
  },
  sendingHint: {
    android: 'A card shows what will be sent; Cancel or say stop during the countdown.',
    ios: 'A card shows the event; tap Cancel during the countdown.',
  },

  // Privacy → Your data
  exportHint: {
    android:
      'Everything is stored encrypted on this phone only. Export copies all of it (text, photos, video and audio) to a folder you choose.',
    ios: 'Everything is stored encrypted on this iPhone only. Export copies all of it (text and photos) to a folder you choose in Files.',
  },
  storageCleanupNote: {
    android:
      'When space runs low, the oldest video goes first, then camera stills past their keep period. Text, memories and photos you asked about are never deleted without asking.',
    ios: 'Text, memories and photos you asked about are never deleted without asking.',
  },
  deleteAllBody: {
    android:
      'All memories, people, facts, photos, video, settings and downloaded models are permanently deleted, as if Sidekick was uninstalled. The app then closes.',
    ios: 'All memories, people, facts, photos, settings and downloaded models are permanently deleted, as if Sidekick was uninstalled. The app then starts again.',
  },

  // Phone features
  listenFeature: {
    android: 'Listen in the background for your wake word',
    ios: 'Listen in the background',
  },
  translateFeature: {
    android: 'Translate, including the text in the camera view',
    ios: 'Translate, including the text in photos',
  },

  // Chat replies
  scanNeedsPhoto: {
    android: 'Point the camera at the code, then say "scan this".',
    ios: 'Tap the camera button, point it at the code, then ask "scan this".',
  },
  translateNeedsPhoto: {
    android:
      'Point the camera at the text (or show it on screen and hold the home button), then say "translate this".',
    ios: 'Tap the camera button, point it at the text, then say "translate this".',
  },

  // First run
  introText: {
    android:
      "Hi, I'm ready. I run entirely on this phone, so nothing you show me or say leaves it. " +
      'Point the camera at something and ask, or tell me something to remember.',
    ios:
      "Hi, I'm ready. I run entirely on this phone, so nothing you show me or say leaves it. " +
      'Tap the camera button to take a photo and ask about it, or tell me something to remember.',
  },
  explainerWhat: {
    android:
      'An assistant that sees and hears what you do, remembers it, and answers questions about it.',
    ios: 'An assistant you ask by voice or text. Show it a photo or tell it something, and it remembers and answers questions about it.',
  },
  explainerGoodAt: {
    android:
      "Remembering what you saw and heard, reminders, drafting messages and emails, and telling you about what's in front of you.",
    ios: "Remembering what you told it and showed it, reminders, calendar events, and telling you about what's in your photos.",
  },
} satisfies Record<string, Pair>;

export type TextKey = keyof typeof TEXTS;

/** The wording for this phone; `{name}` placeholders are filled from vars. */
export function platformText(
  key: TextKey,
  vars: Record<string, string> = {},
  os: Os = currentOs(),
): string {
  return TEXTS[key][os].replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** Replies only the iPhone gives: what it can't do there, and what to do instead. */
export const IPHONE = {
  liveCamera:
    'iPhone apps can’t film in the background, so there is no live camera. Tap the camera button to take a photo, then ask about it.',
  liveCameraSettings:
    'iPhone apps can’t film in the background, so there is no live camera memory. Tap the camera button on the Ask screen to take a photo and ask about it; it is kept if Remember photos is on.',
  cameraSettings:
    'There are no camera settings to change on iPhone. Tap the camera button to take a photo instead.',
  listen: 'iPhone apps can’t listen in the background. Hold the mic button to ask.',
  routines:
    'Routines aren’t possible on iPhone: apps can’t run by themselves at a set time or when something happens. Reminders still work, e.g. "remind me at 6pm to call Sam".',
  takePhotoFirst: 'Tap the camera button to take a photo, then ask.',
  cameraOpened: 'The camera is open. Point it at what you want to know about, then tap send.',
  saveToPhotos: 'Save to Photos',
  savedToPhotos: 'Saved to Photos',
  quietHoursSection:
    'Sidekick doesn’t speak answers out loud between these times (Assistant › Quiet at night).',
  googleNotSetUp: 'Not on iPhone yet: Google sign-in isn’t set up for iPhone',
} as const;

/** Every iPhone text above, for the wording test. */
export function allIphoneTexts(): string[] {
  return [...Object.values(TEXTS).map((t) => t.ios), ...Object.values(IPHONE)];
}

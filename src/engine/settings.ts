import type { CaptionFramesMode } from '@/memory/photo-text';
import SidekickNative from '../../modules/sidekick-native';
import type { PausePlace } from './place-logic';
import type { HandsFreeMode, ReadIncomingMode } from './hands-free-logic';
import type { ReadBackMode } from './readback-logic';
import { DEFAULT_WAKE_PHRASE } from './wake-word';
import type { ConsentChoice } from '@/memory/consent-region';

/** User settings, stored on the phone. Every feature can be switched off. */
export type Settings = {
  wakePhrase: string;
  /**
   * "Understand other languages around me": Listen uses Parakeet v3 (25 European languages) and
   * lines in another language get an English translation. Sidekick itself stays English.
   */
  understandOtherLanguages: boolean;
  /** Show the conversation live on the Ask screen while listening (display only). */
  showConversation: boolean;
  /**
   * With other people: nothing around you is transcribed or kept; only push-to-talk and the wake
   * word are taken (see listen-mode.ts).
   */
  instructionsOnly: boolean;
  /** Keep transcripts of conversations around you while listening (not just questions). */
  recordConversations: boolean;
  /**
   * Only keep other people's speech after they agree (see consent.ts). 'auto' follows the
   * recording law where the phone is (consent-region.ts).
   */
  consent: ConsentChoice;
  speakAnswers: boolean;
  /** Save photos taken for questions into memory. */
  rememberPhotos: boolean;
  /** Delete memories older than this many days (0 = keep forever). */
  retentionDays: number;
  /** Auto-pause listening every day between quietStart and quietEnd (minutes since midnight). */
  quietHours: boolean;
  quietStart: number;
  quietEnd: number;
  /** Places where listening auto-pauses. */
  pausePlaces: PausePlace[];
  /**
   * Remember where you were (location track, named places, parking) while Sidekick listens or is
   * open. Needs the location permission (asked on first use); stays on the phone.
   */
  locationMemory: boolean;
  /** Data sources (all off until the user turns them on; see features/settings/SourcesSection). */
  sourceNotes: boolean;
  sourceFolders: boolean;
  /** Folders the user picked (Storage Access Framework content:// URIs). */
  folderUris: string[];
  sourceContacts: boolean;
  sourceCalendar: boolean;
  /** Android only: keep the text of notifications from other apps. */
  sourceNotifications: boolean;
  /** Propose to-dos, events and reminders from what was said (each waits for approval). */
  suggestFollowups: boolean;
  /** The daily briefing: a notification at digestHour (today's calendar, due to-dos and
   *  follow-ups), spoken when Sidekick is next opened. */
  followupDigest: boolean;
  /** Hour (0-23) the digest arrives. */
  digestHour: number;
  /** Online lookup (Wikipedia, DuckDuckGo): off by default; sends only the question text. */
  webLookup: boolean;
  /** Optional user-chosen SearXNG instance (https, JSON format enabled); empty = not used. */
  searxngUrl: string;
  /** User-added RSS/Atom feeds (https) read for news questions; none by default. */
  newsFeeds: string[];

  // Tunables: null = follow the Recommended value for this phone (device-profile.ts), which can
  // change as Sidekick learns how fast the phone is. A number/choice = the user's own override.
  /** Voice for spoken answers: 'auto' = the Recommended one for this phone, chosen once. */
  voiceChoice: VoiceChoice;
  /** Camera frames remembered per second. */
  fps: number | null;
  /** Frames shown to the model for live questions and around a recalled moment. */
  frameWindow: number | null;
  /** Resolution of frames given to the model. */
  imageDetail: ImageDetail | null;
  /** Hours of rolling video kept (stills, text and vectors are kept longer). */
  videoKeepHours: number | null;
  /** Keep the live camera filming with the screen off / locked (Recommended); off pauses it until unlocked. */
  cameraWhileLocked: boolean;
  /** Which phone camera films (a USB camera, when used, has no lens choice). */
  cameraLens: 'back' | 'front';
  /**
   * When Gemma writes a rich caption (objects, counts, text, movement) for each stored camera
   * frame while idle, so later questions can be answered from memory: never, on the charger, or
   * on battery too (above 30%). Older versions stored a boolean. On the phone only.
   */
  captionFrames: CaptionFramesMode | boolean;
  /** Days of conversation audio kept for listening back (0 = forever). */
  audioKeepDays: number | null;
  /** Space always left free for the phone, in GB. */
  storageReserveGB: number | null;
  /** Off the record: uses memories, saves nothing. Never persisted (off after a restart). */
  offTheRecord: boolean;
  /** Better models: download and switch automatically, ask first, or never. */
  modelUpdates: SmartDefault;
  /** Get quick fixes (Expo OTA, Wi-Fi only). Off = the app never contacts Expo. */
  quickFixes: boolean;
  /** Messages, emails, events and calls: send after a 5 s countdown, at once, or ask first. */
  actionSend: 'countdown' | 'instant' | 'ask';
  /** Read a draft aloud before it sends and listen for yes / no / changes (null = 'voice'). */
  readBack: ReadBackMode | null;
  /** Driving / walking: spoken answers, read-back, bigger buttons (null = 'auto': car or walk mode). */
  handsFree: HandsFreeMode | null;
  /** Read new messages aloud (null = 'off'). */
  readIncoming: ReadIncomingMode | null;
  /** No speaking out loud between quietStart and quietEnd or in Do Not Disturb, except into
   *  headphones (null = on). */
  quietSpeech: boolean | null;
  /** A light tick on send, cancel and when listening starts (null = on). */
  haptics: boolean | null;
  /** When the daily briefing was last spoken (ms), so it is said once a day. */
  lastBriefingAt: number | null;
  /** Large downloads on mobile data. */
  mobileDataDownloads: 'ask' | 'auto' | 'off';
  /** App lock: fingerprint, face or the phone's PIN to open Sidekick. */
  appLock: boolean;
  /** Minutes away before it asks again (0 = every time; null = Recommended, 1). */
  appLockAfterMin: number | null;
  /** Live notes of each conversation heard with Listen on, updated as it goes (null = 'auto'). */
  conversationNotes: 'auto' | 'off' | null;
  /** When Google Drive last took a backup (ms). */
  lastDriveBackupAt: number | null;
  /** Speech speed of spoken answers, 0.5–2 (null = normal, 1). "Speak slower / faster". */
  speechRate: number | null;
  /** Measured silently in the background; refine the Recommended values (null = not yet). */
  measuredTokPerSec: number | null;
  measuredVoiceFirstSoundMs: number | null;
};

export type VoiceChoice = 'auto' | 'pocket' | 'system';
export type ImageDetail = 'low' | 'medium' | 'high';
/** The smart-defaults pattern: Automatic (Recommended) / Ask me / Off. */
export type SmartDefault = 'auto' | 'ask' | 'off';

/** Settings that only last while the app runs. */
const NOT_SAVED = ['offTheRecord'] as const;

export const DEFAULTS: Settings = {
  understandOtherLanguages: false,
  wakePhrase: DEFAULT_WAKE_PHRASE,
  showConversation: true,
  instructionsOnly: false,
  recordConversations: true,
  consent: 'auto',
  speakAnswers: true,
  rememberPhotos: true,
  retentionDays: 0,
  quietHours: false,
  quietStart: 22 * 60,
  quietEnd: 7 * 60,
  pausePlaces: [],
  locationMemory: true,
  sourceNotes: false,
  sourceFolders: false,
  folderUris: [],
  sourceContacts: false,
  sourceCalendar: false,
  sourceNotifications: false,
  suggestFollowups: true,
  followupDigest: false,
  digestHour: 8,
  webLookup: false,
  searxngUrl: '',
  newsFeeds: [],
  voiceChoice: 'auto',
  fps: null,
  frameWindow: null,
  imageDetail: null,
  videoKeepHours: null,
  cameraWhileLocked: true,
  cameraLens: 'back',
  captionFrames: 'charging',
  audioKeepDays: null,
  storageReserveGB: null,
  offTheRecord: false,
  modelUpdates: 'auto',
  quickFixes: true,
  actionSend: 'countdown',
  readBack: null,
  handsFree: null,
  readIncoming: null,
  quietSpeech: null,
  haptics: null,
  lastBriefingAt: null,
  mobileDataDownloads: 'ask',
  appLock: false,
  appLockAfterMin: null,
  conversationNotes: null,
  lastDriveBackupAt: null,
  speechRate: null,
  measuredTokPerSec: null,
  measuredVoiceFirstSoundMs: null,
};

const KEY = 'settings.v1';
let cache: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  if (cache) return cache;
  let saved: Partial<Settings> = {};
  try {
    saved = JSON.parse(SidekickNative.kvGet(KEY) ?? '{}');
  } catch {
    saved = {};
  }
  for (const k of NOT_SAVED) delete saved[k];
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  const toSave: Partial<Settings> = { ...cache };
  for (const k of NOT_SAVED) delete toSave[k];
  SidekickNative.kvSet(KEY, JSON.stringify(toSave));
  listeners.forEach((l) => l(cache!));
  return cache;
}

export function onSettingsChange(l: (s: Settings) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Test hook: forget the cached copy so the next read comes from storage. */
export function resetSettingsCache() {
  cache = null;
}

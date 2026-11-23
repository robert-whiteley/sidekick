import SidekickNative from '../../modules/sidekick-native';
import type { PausePlace } from './place-logic';
import { DEFAULT_WAKE_PHRASE } from './wake-word';
import type { ConsentChoice } from '@/memory/consent-region';

/** User settings, stored on the phone. Every feature can be switched off. */
export type Settings = {
  wakePhrase: string;
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
  /** A morning notification summarising yesterday's open and today's follow-ups. */
  followupDigest: boolean;
  /** Hour (0-23) the digest arrives. */
  digestHour: number;
  /** Online lookup (Wikipedia, DuckDuckGo): off by default; sends only the question text. */
  webLookup: boolean;
  /** Optional user-chosen SearXNG instance (https, JSON format enabled); empty = not used. */
  searxngUrl: string;
  /** User-added RSS/Atom feeds (https) read for news questions; none by default. */
  newsFeeds: string[];
};

export const DEFAULTS: Settings = {
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
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  SidekickNative.kvSet(KEY, JSON.stringify(cache));
  listeners.forEach((l) => l(cache!));
  return cache;
}

export function onSettingsChange(l: (s: Settings) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

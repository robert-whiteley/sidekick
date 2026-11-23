import SidekickNative from '../../modules/sidekick-native';
import type { PausePlace } from './place-logic';
import { DEFAULT_WAKE_PHRASE } from './wake-word';
import type { ConsentChoice } from '@/memory/consent-region';

/** User settings, stored on the phone. Every feature can be switched off. */
export type Settings = {
  wakePhrase: string;
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
};

export const DEFAULTS: Settings = {
  wakePhrase: DEFAULT_WAKE_PHRASE,
  recordConversations: true,
  consent: 'auto',
  speakAnswers: true,
  rememberPhotos: true,
  retentionDays: 0,
  quietHours: false,
  quietStart: 22 * 60,
  quietEnd: 7 * 60,
  pausePlaces: [],
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

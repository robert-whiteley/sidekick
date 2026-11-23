import SidekickNative from '../../modules/sidekick-native';
import { DEFAULT_WAKE_PHRASE } from './wake-word';

/** User settings, stored on the phone. Every feature can be switched off. */
export type Settings = {
  wakePhrase: string;
  /** Keep transcripts of conversations around you while listening (not just questions). */
  recordConversations: boolean;
  /** Only keep other people's speech after they agree (see consent.ts). */
  consentMode: boolean;
  speakAnswers: boolean;
  /** Save photos taken for questions into memory. */
  rememberPhotos: boolean;
  /** Delete memories older than this many days (0 = keep forever). */
  retentionDays: number;
};

export const DEFAULTS: Settings = {
  wakePhrase: DEFAULT_WAKE_PHRASE,
  recordConversations: true,
  consentMode: true,
  speakAnswers: true,
  rememberPhotos: true,
  retentionDays: 0,
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

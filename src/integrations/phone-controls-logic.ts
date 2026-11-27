/**
 * Requests that control the phone itself ("open Spotify", "torch on", "volume up", "turn on Do
 * Not Disturb", "brightness 50%", "turn off Wi-Fi", "play jazz on Spotify"). Pure; tested in
 * __tests__/phone-controls-test.ts. Run by phone-controls.ts.
 */

export type PanelKind = 'wifi' | 'internet' | 'bluetooth' | 'airplane' | 'nfc';

export type Control =
  | { type: 'openApp'; name: string }
  | { type: 'torch'; on: boolean | null }
  | { type: 'volume'; dir: 'up' | 'down' | 'mute' | 'unmute' | 'max' | 'set'; percent?: number }
  | { type: 'dnd'; on: boolean }
  | { type: 'brightness'; percent: number | 'auto' | 'up' | 'down' }
  | { type: 'panel'; kind: PanelKind; on: boolean | null }
  | { type: 'play'; query: string; app: string | null }
  | { type: 'screen' };

/** Media apps by spoken name → package, for "play X on Y". */
export const MEDIA_APPS: Record<string, string> = {
  spotify: 'com.spotify.music',
  'youtube music': 'com.google.android.apps.youtube.music',
  'yt music': 'com.google.android.apps.youtube.music',
  youtube: 'com.google.android.youtube',
  deezer: 'deezer.android.app',
  soundcloud: 'com.soundcloud.android',
  tidal: 'com.aspiro.tidal',
  'amazon music': 'com.amazon.mp3',
  'pocket casts': 'au.com.shiftyjelly.pocketcasts',
  audible: 'com.audible.application',
  'bbc sounds': 'com.bbc.sounds',
};

export type LaunchableApp = { label: string; pkg: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The installed app the user named: exact label, then label starts with it, then contains it. */
export function matchApp(name: string, apps: LaunchableApp[]): LaunchableApp | null {
  const n = norm(name);
  if (n.length < 2) return null;
  const scored = apps
    .map((a) => {
      const l = norm(a.label);
      const score = l === n ? 3 : l.startsWith(n) ? 2 : n.length >= 4 && l.includes(n) ? 1 : 0;
      return { a, score, len: l.length };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.len - y.len);
  return scored[0]?.a ?? null;
}

/** Brighter / dimmer: a step of a fifth of the range, kept on screen. */
export function stepBrightness(current: number, dir: 'up' | 'down'): number {
  return Math.max(1, Math.min(100, current + (dir === 'up' ? 20 : -20)));
}

export const PANEL_NAMES: Record<PanelKind, string> = {
  wifi: 'Wi-Fi',
  internet: 'mobile data',
  bluetooth: 'Bluetooth',
  airplane: 'airplane mode',
  nfc: 'NFC',
};

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

const LEAD =
  /^(?:hey |ok |okay )?(?:sidekick,? )?(?:please )?(?:(?:can|could|would|will) you (?:please )?)?/i;
const TAIL = /[\s,]*(?:please|thanks|thank you|for me|now)?[.!?\s]*$/i;

function clean(q: string): string {
  return q.trim().replace(/\s+/g, ' ').replace(LEAD, '').replace(TAIL, '').trim();
}

const ON = /\b(on|enable|start|activate)\b/i;
const OFF = /\b(off|disable|stop|deactivate)\b/i;

function onOff(q: string): boolean | null {
  if (OFF.test(q)) return false;
  if (ON.test(q)) return true;
  return null;
}

const PANELS: [RegExp, PanelKind][] = [
  [/\bwi-?fi\b|\bwireless\b/i, 'wifi'],
  [/\bbluetooth\b/i, 'bluetooth'],
  [/\b(mobile|cellular) data\b|\bdata roaming\b|\bhotspot\b/i, 'internet'],
  [/\bairplane mode\b|\baeroplane mode\b|\bflight mode\b/i, 'airplane'],
  [/\bnfc\b/i, 'nfc'],
];

export function parseControl(question: string): Control | null {
  const q = clean(question);
  if (!q || q.length > 80) return null;
  let m: RegExpExecArray | null;

  // What's on my screen: answered through the assistant entry (the screenshot), see actions.
  if (
    /^(what('s| is) on (my|the) screen|read (my|the) screen|what am i looking at on (my|the) screen)$/i.test(
      q,
    )
  )
    return { type: 'screen' };

  if (
    /\b(torch|flash ?light|flash)\b/i.test(q) &&
    /^(turn|switch|put|flash|torch|flashlight|toggle|lights?)\b/i.test(q)
  )
    return { type: 'torch', on: /\btoggle\b/i.test(q) ? null : onOff(q) };

  if (/\b(do not disturb|dnd|don't disturb|silent mode)\b/i.test(q)) {
    const on = onOff(q);
    if (on !== null) return { type: 'dnd', on };
  }

  if (/\b(volume|sound|louder|quieter|mute|unmute)\b/i.test(q) && !/\bwhat\b/i.test(q)) {
    if (/\bunmute\b/i.test(q)) return { type: 'volume', dir: 'unmute' };
    if (/\bmute\b/i.test(q) || /\b(sound|volume) off\b/i.test(q))
      return { type: 'volume', dir: 'mute' };
    if ((m = /\b(\d{1,3}) ?(%|percent)/i.exec(q)))
      return { type: 'volume', dir: 'set', percent: +m[1] };
    if (/\b(max|maximum|full|all the way up)\b/i.test(q)) return { type: 'volume', dir: 'max' };
    if (/\b(up|louder|raise|increase|higher)\b/i.test(q)) return { type: 'volume', dir: 'up' };
    if (/\b(down|quieter|lower|decrease|reduce)\b/i.test(q)) return { type: 'volume', dir: 'down' };
  }

  if (/\b(brightness|brighter|dimmer|dim the screen|screen (dimmer|brighter))\b/i.test(q)) {
    if (/\b(auto|automatic|adaptive)\b/i.test(q)) return { type: 'brightness', percent: 'auto' };
    if ((m = /\b(\d{1,3}) ?(%|percent)/i.exec(q))) return { type: 'brightness', percent: +m[1] };
    if (/\b(max|maximum|full)\b/i.test(q)) return { type: 'brightness', percent: 100 };
    if (/\b(min|minimum|lowest)\b/i.test(q)) return { type: 'brightness', percent: 1 };
    if (/\b(up|brighter|raise|increase|higher)\b/i.test(q))
      return { type: 'brightness', percent: 'up' };
    if (/\b(down|dimmer|dim|lower|decrease|reduce)\b/i.test(q))
      return { type: 'brightness', percent: 'down' };
  }

  for (const [re, kind] of PANELS) {
    if (
      re.test(q) &&
      /^(turn|switch|toggle|enable|disable|put|go|open|start|stop|connect|disconnect)\b/i.test(q)
    )
      return { type: 'panel', kind, on: onOff(q.replace(re, '')) };
  }

  // "Play Bohemian Rhapsody on Spotify", "play some jazz", "play the latest episode of X on Pocket Casts".
  if (
    (m =
      /^(?:play|put on|listen to)\s+(.+?)(?:\s+(?:on|in|using|with)\s+([a-z0-9 .+-]{2,30}))?$/i.exec(
        q,
      ))
  ) {
    const query = m[1].replace(/^(?:some|me some|me)\s+/i, '').trim();
    // Bare "play", "play music", "play the next song": media buttons (parse.ts) handle those.
    if (
      !query ||
      (/^(the )?(music|song|playback|podcast|next|previous|last|it|that)\b/i.test(query) && !m[2])
    )
      return null;
    return { type: 'play', query, app: m[2]?.trim() ?? null };
  }

  if ((m = /^(?:open|launch|start|run|go to)\s+(?:the\s+|my\s+)?(.+?)(?:\s+app)?$/i.exec(q))) {
    const name = m[1].trim();
    // "open directions to…", "open the door" (not an app: matched against installed apps later).
    if (/\b(directions|navigation|a |an |timer|alarm|chat|conversation)\b/i.test(name)) return null;
    return { type: 'openApp', name };
  }
  return null;
}

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

/**
 * While the phone is locked (a spoken question with the screen off, or the assistant gesture on
 * the lock screen), only things with no personal data run: sums, conversions, the time,
 * timers and alarms, torch and volume. Everything else asks to unlock first.
 */
export function safeWhenLocked(c: Control | null, question: string, quick: boolean): boolean {
  if (quick) return true;
  if (c) return c.type === 'torch' || c.type === 'volume';
  const q = clean(question);
  return (
    /\b(timer|alarm)s?\b/i.test(q) && !/\b(text|message|email|tell|call|calendar|when)\b/i.test(q)
  );
}

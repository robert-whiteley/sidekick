/**
 * Ways into Sidekick from outside the app (Android): the phone's assistant gesture ("ask about my
 * screen"), the Quick Settings tile and the home-screen widget. Native code opens
 * `sidekick://?entry=<kind>&t=<time>`; Expo Router hands the query to the home screen.
 *
 * The screenshot itself never travels in the link (any app can open a link): the assistant
 * session stores it under ASSIST_KEY in the app's own settings, and we read it from there.
 */

/** listen: ask by voice; capture: Remember this; camera: live camera; listenmode: Listen on. */
export type EntryKind = 'listen' | 'capture' | 'screen' | 'camera' | 'listenmode';

export type EntryRequest = { kind: EntryKind; nonce: string };

export type ScreenGrab = {
  /** JPEG in the app's cache, or null when the screenshot was blocked (secure app, setting off). */
  shot: string | null;
  /** Text read from the screen's views (may be empty). */
  text: string;
  at: number;
  /** A picture shared into Sidekick from another app (share sheet), not a screenshot. */
  shared?: boolean;
};

/** Native key (SharedPreferences "sidekick") with the latest screen grab as JSON. */
export const ASSIST_KEY = 'assist.last';

export const SCREEN_QUESTION = "What's on my screen?";

/** Asked when a shared picture is sent with an empty composer. */
export const SHARED_QUESTION = "What's in this picture?";

/** A grab older than this is stale (e.g. left over from an earlier launch). */
export const SCREEN_MAX_AGE_MS = 2 * 60_000;

const KINDS: readonly EntryKind[] = ['listen', 'capture', 'screen', 'camera', 'listenmode'];

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The entry request in a route's search params, or null. */
export function parseEntry(params: Params): EntryRequest | null {
  const kind = first(params.entry);
  if (!kind || !(KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as EntryKind, nonce: first(params.t) ?? kind };
}

/** Only screenshots the assistant session wrote into our own cache are accepted. */
export function isAssistShot(path: string): boolean {
  return /\/cache\/assist\/shot-\d+\.jpg$/.test(path) && !path.includes('..');
}

/** Parses the stored screen grab; null if missing, malformed or stale. */
export function parseScreenGrab(json: string | null, now = Date.now()): ScreenGrab | null {
  if (!json) return null;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const at = typeof o.at === 'number' ? o.at : NaN;
  if (!Number.isFinite(at) || now - at > SCREEN_MAX_AGE_MS || at - now > 60_000) return null;
  const shot = typeof o.shot === 'string' && isAssistShot(o.shot) ? o.shot : null;
  const text = typeof o.text === 'string' ? o.text : '';
  if (!shot && !text.trim()) return null;
  return { shot, text, at };
}

/** Short note stored with a saved screenshot so it can be found by searching memory. */
export function screenNote(text: string, max = 400): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return `Screen: ${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}`;
}

/**
 * The question sent with a screenshot. When there is no screenshot, the screen's text stands in
 * for it (capped, since every prompt token delays the first word).
 */
export function screenQuestion(question: string, grab: ScreenGrab, maxText = 1500): string {
  const q = question.trim() || SCREEN_QUESTION;
  if (grab.shot) return q;
  const t = grab.text.replace(/\s+/g, ' ').trim().slice(0, maxText).trimEnd();
  return `${q}\n\nText on my screen: ${t}`;
}

/** Whether the home screen can act on an entry yet (model loaded; camera up for a capture). */
export function entryReady(
  kind: EntryKind,
  s: { idle: boolean; cameraOn: boolean; cameraReady: boolean },
): boolean {
  if (kind === 'capture') return !s.cameraOn || s.cameraReady;
  return s.idle;
}

/** Hands-free listening (tile, widget, assistant) stops by itself after this long. */
export const HANDS_FREE_MAX_MS = 12_000;

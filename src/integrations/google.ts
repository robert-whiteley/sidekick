/**
 * Optional Google sign-in, shared by three switches, each asking only for its own scope when it
 * is first turned on (incremental authorization; ADR 0008):
 * - email: gmail.send (send approved emails; never read mail)
 * - googleTasks: tasks (two-way sync of Sidekick to-dos with Google Tasks)
 * - driveBackup: drive.file (only files Sidekick itself creates: the backup export)
 * All inactive until the owner's OAuth client id is in app.json `expo.extra.google.androidClientId`.
 */
import Constants from 'expo-constants';
import { integrationsNative } from './native';
import { setSwitch } from './prefs';

export const SCOPES = {
  gmail: 'https://www.googleapis.com/auth/gmail.send',
  tasks: 'https://www.googleapis.com/auth/tasks',
  drive: 'https://www.googleapis.com/auth/drive.file',
} as const;

export type GoogleFeature = keyof typeof SCOPES;

/** Which registry switch each scope belongs to. */
export const FEATURE_SWITCH: Record<GoogleFeature, [string, string]> = {
  gmail: ['email', 'send'],
  tasks: ['googleTasks', 'sync'],
  drive: ['driveBackup', 'backup'],
};

export function googleConfigured(extra: unknown = Constants.expoConfig?.extra): boolean {
  const e = extra as
    { google?: { androidClientId?: unknown }; gmail?: { androidClientId?: unknown } } | undefined;
  const id = e?.google?.androidClientId ?? e?.gmail?.androidClientId;
  return typeof id === 'string' && id.trim().length > 0;
}

export function googleAvailable(): boolean {
  return googleConfigured() && !!integrationsNative();
}

/** An access token for one scope; the first time, Google's consent screen for just that scope. */
export async function googleToken(feature: GoogleFeature): Promise<string> {
  const native = integrationsNative();
  if (!native || !googleConfigured()) throw new Error('Google sign-in is not set up on this phone');
  return native.googleAuthorize([SCOPES[feature]]);
}

export async function clearGoogleToken(token: string) {
  await integrationsNative()?.googleClearToken(token);
}

/**
 * Settings switch turned on: ask Google for that one scope, then save the switch. Returns false
 * (switch stays off) when not set up or the user declined.
 */
export async function connectGoogle(feature: GoogleFeature): Promise<boolean> {
  try {
    await googleToken(feature);
  } catch {
    return false;
  }
  const [id, sw] = FEATURE_SWITCH[feature];
  setSwitch(id, sw, true);
  return true;
}

export class OfflineError extends Error {}

/** fetch with a Bearer token; retries once with a fresh token on 401. Offline → OfflineError. */
export async function googleFetch(
  feature: GoogleFeature,
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await googleToken(feature);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new OfflineError('No internet');
    }
    if (res.status === 401 && attempt === 0) {
      await clearGoogleToken(token);
      continue;
    }
    return res;
  }
}

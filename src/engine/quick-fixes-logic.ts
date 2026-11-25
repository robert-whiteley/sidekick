/**
 * Quick fixes (Expo OTA updates, JS and assets only). The app never checks on its own
 * (app.json updates.checkAutomatically = NEVER); this decides when it may, from the user's
 * "Get quick fixes" switch: on Wi-Fi (or cable) only, at most once every 6 hours.
 */
export const QUICK_FIX_EVERY_MS = 6 * 60 * 60_000;

export function quickFixCheckDue(o: {
  enabled: boolean;
  updatesEnabled: boolean;
  wifi: boolean;
  lastCheckAt: number | null;
  now: number;
}): boolean {
  if (!o.enabled || !o.updatesEnabled || !o.wifi) return false;
  return o.lastCheckAt == null || o.now - o.lastCheckAt >= QUICK_FIX_EVERY_MS;
}

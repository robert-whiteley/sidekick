/** When the app lock asks again (pure; tested in __tests__/app-lock-test.ts). */

export const APP_LOCK_AFTER_MIN = 1;
export const APP_LOCK_CHOICES = [0, 1, 5, 15] as const;

/** Locked on open, and after being away longer than the grace time. */
export function needsUnlock(s: {
  enabled: boolean;
  /** When the app last went to the background; null = it has just started. */
  leftAt: number | null;
  now: number;
  afterMin: number | null;
}): boolean {
  if (!s.enabled) return false;
  if (s.leftAt === null) return true;
  return s.now - s.leftAt >= (s.afterMin ?? APP_LOCK_AFTER_MIN) * 60_000;
}

/** Whether the phone can lock the app: needs a screen lock (PIN, pattern, password) at least. */
export function lockAvailable(level: number): boolean {
  return level > 0; // SecurityLevel.NONE = 0
}

export function lockAfterLabel(min: number): string {
  return min === 0 ? 'Every time' : `After ${min} min away`;
}

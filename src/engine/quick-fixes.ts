import * as Updates from 'expo-updates';

import { connection } from './downloads';
import { notices } from './notices';
import { quickFixCheckDue } from './quick-fixes-logic';
import { getSettings } from './settings';

let lastCheckAt: number | null = null;
let busy = false;

/**
 * Checks Expo for a quick fix when allowed; a downloaded fix applies on the next cold start
 * (never a reload mid-use). The request carries only the app's runtime version, platform,
 * channel and current update id (Expo also sees the phone's IP address). Never throws.
 */
export async function checkQuickFix(now = Date.now()): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const { wifi } = await connection();
    const due = quickFixCheckDue({
      enabled: getSettings().quickFixes,
      updatesEnabled: Updates.isEnabled,
      wifi,
      lastCheckAt,
      now,
    });
    if (!due) return;
    lastCheckAt = now;
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const got = await Updates.fetchUpdateAsync();
    if (got.isNew)
      notices.post({
        key: 'quick-fix',
        kind: 'info',
        text: 'A fix for Sidekick was downloaded: it applies next time Sidekick starts',
        href: '/settings/advanced',
      });
  } catch (e) {
    console.log(`[quick-fix] ${String(e)}`);
  } finally {
    busy = false;
  }
}

export function startQuickFixes(): () => void {
  void checkQuickFix();
  const timer = setInterval(() => void checkQuickFix(), 30 * 60_000);
  return () => clearInterval(timer);
}

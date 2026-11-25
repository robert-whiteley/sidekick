import { getNetworkStateAsync, NetworkStateType } from 'expo-network';

import SidekickNative from '../../modules/sidekick-native';
import { batteryState } from './battery';
import { notices } from './notices';
import { getSettings, updateSettings } from './settings';
import { backupDue, backupToDrive } from '@/integrations/drive-backup';
import { googleConfigured, OfflineError } from '@/integrations/google';
import { isOn } from '@/integrations/prefs';
import { exportEverything } from '@/memory/store';

let running: Promise<boolean> | null = null;
let lastTryAt: number | null = null;

export const driveBackupOn = () => googleConfigured() && isOn('driveBackup', 'backup');

/** Exports everything and uploads it to Drive (keeping the last two); a notice says how it went. */
export function backupNow(): Promise<boolean> {
  if (running) return running;
  running = (async () => {
    lastTryAt = Date.now();
    let zip: string | null = null;
    try {
      zip = await exportEverything();
      await backupToDrive(zip);
      updateSettings({ lastDriveBackupAt: Date.now() });
      notices.post({
        key: 'drive-backup',
        kind: 'info',
        text: 'Backed up to Google Drive',
        href: '/settings/privacy',
      });
      return true;
    } catch (e) {
      notices.post({
        key: 'drive-backup',
        kind: 'info',
        text:
          e instanceof OfflineError
            ? 'Google Drive backup waits for a connection'
            : `Google Drive backup failed: ${e instanceof Error ? e.message : String(e)}`,
        href: '/settings/privacy',
      });
      return false;
    } finally {
      if (zip) SidekickNative.deleteFile(zip);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Weekly, on Wi-Fi and charging, while the Drive backup switch is on. */
export async function driveBackupIfDue(now = Date.now()) {
  if (running || !driveBackupOn()) return;
  const lastAt = getSettings().lastDriveBackupAt;
  if (!backupDue({ lastAt, lastTryAt, now, wifi: true, charging: true })) return;
  const [net, bat] = await Promise.all([getNetworkStateAsync(), batteryState()]);
  const wifi = net.type === NetworkStateType.WIFI && net.isInternetReachable !== false;
  if (!backupDue({ lastAt, lastTryAt, now, wifi, charging: bat.charging })) return;
  await backupNow();
}

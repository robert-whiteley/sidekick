import * as Application from 'expo-application';

import SidekickNative from '../../modules/sidekick-native';
import { notices } from '@/engine/notices';
import { shouldShowWhatsNew } from './whats-new';

const KEY = 'whatsNew.lastSeenVersion';

/**
 * Once after an update: a faint chat line "Updated to 1.0.1 · see what's new" linking to
 * /whats-new. The version is remembered at once, so it shows a single time. A fresh install
 * only records the version (no notice).
 */
export function checkWhatsNew(current: string | null = Application.nativeApplicationVersion): void {
  if (!current) return;
  const lastSeen = SidekickNative.kvGet(KEY);
  if (shouldShowWhatsNew(lastSeen, current)) {
    notices.post({
      key: 'whats-new',
      kind: 'info',
      text: `Updated to ${current} · see what's new`,
      href: '/whats-new',
    });
  }
  if (lastSeen !== current) SidekickNative.kvSet(KEY, current);
}

/**
 * The offline place-name pack (geo-pack.ts), read once: from the SidekickOffline module's assets
 * on Android, from the app bundle on iPhone. Null where it is missing (tests): place names are
 * then simply left out.
 */
import { Platform } from 'react-native';

import { type GeoPack, parseGeoPack } from './geo-pack';

let pack: GeoPack | null | undefined;

export function geoPack(): GeoPack | null {
  if (pack !== undefined) return pack;
  pack = null;
  if (Platform.OS === 'ios') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const n = require('../../modules/sidekick-native').default as {
        geoPack?(): Uint8Array | null;
      };
      const bytes = n.geoPack?.();
      if (bytes?.length) pack = parseGeoPack(bytes);
    } catch (e) {
      console.log(`[geo] place pack unavailable: ${String(e)}`);
    }
    return pack;
  }
  if (Platform.OS !== 'android') return pack;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require('expo');
    const n = requireOptionalNativeModule('SidekickOffline') as {
      geoPack(): Uint8Array | null;
    } | null;
    const bytes = n?.geoPack();
    if (bytes?.length) pack = parseGeoPack(bytes);
  } catch (e) {
    console.log(`[geo] place pack unavailable: ${String(e)}`);
  }
  return pack;
}

/** Tests. */
export function setGeoPack(g: GeoPack | null | undefined) {
  pack = g;
}

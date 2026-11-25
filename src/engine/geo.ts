/**
 * The offline place-name pack (geo-pack.ts), read once from the native module's assets. Null on
 * phones without it (iOS for now, tests): place names are then simply left out.
 */
import { Platform } from 'react-native';

import { type GeoPack, parseGeoPack } from './geo-pack';

let pack: GeoPack | null | undefined;

export function geoPack(): GeoPack | null {
  if (pack !== undefined) return pack;
  pack = null;
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

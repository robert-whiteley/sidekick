import SidekickNative from '../../modules/sidekick-native';
import { consentNeeded, type Region } from '@/memory/consent-region';
import { getSettings } from './settings';

/**
 * Where the phone is, for laws that depend on it. Uses the offline place lookup when location is
 * known (gives the US state), otherwise the SIM / network / language country. No network.
 */
export function currentRegion(): Region {
  const fromPlace = placeRegion?.();
  if (fromPlace?.country) return fromPlace;
  return { country: SidekickNative.countryCode(), admin1: null };
}

let placeRegion: (() => Region) | null = null;
/** The places module registers its nearest-city lookup here (avoids an import cycle). */
export function setPlaceRegion(fn: () => Region) {
  placeRegion = fn;
}

/** Is consent mode on right now (the user's choice, or the law where the phone is)? */
export function consentModeNow(): boolean {
  return consentNeeded(getSettings().consent, currentRegion());
}

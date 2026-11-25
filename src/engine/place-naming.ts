/**
 * Asks once to name a spot the user keeps going to, while they are there (place-naming-logic.ts).
 * Checked at most hourly from the location tick in location.ts.
 */
import SidekickNative from '../../modules/sidekick-native';
import { visitsFrom } from './location-logic';
import { allPlaces, locationMemoryOn, refreshPlaces } from './location-track';
import { notices } from './notices';
import { offerActions, offerText, placeOffer } from './place-naming-logic';
import type { LatLon } from './place-logic';
import { placeName } from './places';
import { fixesBetween, namePlace } from '@/memory/places-store';

const KV = 'place-naming.asked';
const EVERY_MS = 60 * 60_000;
const LOOK_BACK_MS = 28 * 24 * 60 * 60_000;
let lastCheck = 0;

function asked(): LatLon[] {
  try {
    const v = SidekickNative.kvGet(KV);
    return v ? (JSON.parse(v) as LatLon[]) : [];
  } catch {
    return [];
  }
}

function markAsked(p: LatLon) {
  try {
    SidekickNative.kvSet(KV, JSON.stringify([...asked(), { lat: p.lat, lon: p.lon }].slice(-200)));
  } catch {}
}

/** If the user is at a frequent unnamed spot not asked about before, asks to name it. */
export async function maybeOfferPlaceName(here: LatLon, now = Date.now()): Promise<boolean> {
  if (now - lastCheck < EVERY_MS || !locationMemoryOn()) return false;
  lastCheck = now;
  const visits = visitsFrom(await fixesBetween(now - LOOK_BACK_MS, now));
  const o = placeOffer(visits, await allPlaces(), asked(), here);
  if (!o) return false;
  markAsked(o.spot); // asked once, whatever the answer
  const town = placeName(o.spot)?.split(',')[0] ?? null;
  return notices.post(
    { key: 'place-naming', kind: 'decision', text: offerText(o, town), actions: offerActions(o) },
    (id) => {
      if (id === 'home' || id === 'work')
        void namePlace(id, o.spot)
          .then((p) => {
            refreshPlaces();
            notices.post({
              key: 'place-naming:done',
              kind: 'info',
              text: `Saved as ${p.name}. Try "when was I last at ${p.name}?"`,
            });
          })
          .catch(() => {});
      else if (id === 'other')
        notices.post({
          key: 'place-naming:done',
          kind: 'info',
          text: 'Say "call this place …" with its name while you\'re here.',
        });
    },
  );
}

/** Tests. */
export function _resetPlaceNaming() {
  lastCheck = 0;
}

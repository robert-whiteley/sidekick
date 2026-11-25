/**
 * Offering to name a spot the user keeps going to: "You're often here (near Banbury, evenings).
 * Name it?" with [Home] [Work] [Other…] [Not now]. Asked once per spot, only while the user is
 * there; "Not now" is never asked again for that spot. Home / Work is only a guess (which button
 * comes first), never saved without a tap. Pure logic, tested; wiring in place-naming.ts.
 */
import {
  frequentPlaces,
  likelyHome,
  type FrequentPlace,
  type NamedPlace,
  STAY_RADIUS_M,
  type Visit,
} from './location-logic';
import { haversineM, type LatLon } from './place-logic';

export type PartOfDay = 'mornings' | 'afternoons' | 'evenings' | 'nights';
export type Usually = PartOfDay | 'weekdays';

export type PlaceOffer = {
  spot: FrequentPlace;
  when: Usually;
  guess: 'home' | 'work' | null;
};

/** Spots already answered ("Not now", or named then) count this far around. */
export const ASKED_RADIUS_M = 300;

const MIN = 60_000;

function part(h: number): PartOfDay {
  return h >= 6 && h < 12 ? 'mornings' : h >= 12 && h < 17 ? 'afternoons' : h >= 17 && h < 22 ? 'evenings' : 'nights'; // prettier-ignore
}

/** When the user is usually at [visits]: the part of the day with the most time. */
export function usualPartOfDay(visits: Visit[]): PartOfDay {
  const ms: Record<PartOfDay, number> = { mornings: 0, afternoons: 0, evenings: 0, nights: 0 };
  for (const v of visits)
    for (let t = v.from; t < v.to; t += 10 * MIN)
      ms[part(new Date(t).getHours())] += Math.min(10 * MIN, v.to - t);
  return (Object.keys(ms) as PartOfDay[]).reduce((a, b) => (ms[b] > ms[a] ? b : a));
}

/** Weekday time between 09:00 and 17:00 at [visits], on how many different weekdays. */
function workDays(visits: Visit[]): number {
  const days = new Set<string>();
  for (const v of visits) {
    let ms = 0;
    for (let t = v.from; t < v.to; t += 10 * MIN) {
      const d = new Date(t);
      if (d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= 9 && d.getHours() < 17)
        ms += Math.min(10 * MIN, v.to - t);
    }
    if (ms >= 3 * 60 * MIN) days.add(new Date(v.from).toDateString());
  }
  return days.size;
}

const has = (named: NamedPlace[], re: RegExp) => named.some((p) => re.test(p.name));

/**
 * The spot to offer naming now, or null: a frequent unnamed spot the user is at ([here]), not
 * asked about before ([asked]).
 */
export function placeOffer(
  visits: Visit[],
  named: NamedPlace[],
  asked: LatLon[],
  here: LatLon,
): PlaceOffer | null {
  const frequent = frequentPlaces(visits, named);
  const spot = frequent.find(
    (f) =>
      haversineM(f, here) <= STAY_RADIUS_M &&
      !asked.some((a) => haversineM(a, f) <= ASKED_RADIUS_M),
  );
  if (!spot) return null;
  const mine = visits.filter((v) => haversineM(v, spot) <= STAY_RADIUS_M);
  const home = likelyHome(frequent);
  const guess =
    home === spot && !has(named, /^home$/i)
      ? 'home'
      : workDays(mine) >= 3 && !has(named, /^(work|office)$/i)
        ? 'work'
        : null;
  return { spot, when: guess === 'work' ? 'weekdays' : usualPartOfDay(mine), guess };
}

/** "You're often here (near Banbury, evenings). Name it?" */
export function offerText(o: PlaceOffer, town: string | null): string {
  const where = town ? `near ${town}, ${o.when}` : o.when;
  return `You're often here (${where}). Name it?`;
}

/** Buttons, the guess first. */
export function offerActions(o: PlaceOffer): { label: string; id: string }[] {
  const home = { label: 'Home', id: 'home' };
  const work = { label: 'Work', id: 'work' };
  const named = o.guess === 'work' ? [work, home] : [home, work];
  return [...named, { label: 'Other…', id: 'other' }, { label: 'Not now', id: 'not-now' }];
}

import type { Visit } from '@/engine/location-logic';
import { offerActions, offerText, placeOffer, usualPartOfDay } from '@/engine/place-naming-logic';

const HOME = { lat: 52.06, lon: -1.34 };
const OFFICE = { lat: 52.1, lon: -1.3 };
const H = 3_600_000;
// Mon 16 Nov 2026 onwards
const day = (i: number, h: number) => new Date(2026, 10, 16 + i, h).getTime();

const nights: Visit[] = [0, 1, 2, 3].map((i) => ({
  ...HOME,
  from: day(i, 19),
  to: day(i, 19) + 10 * H,
}));
const workdays: Visit[] = [0, 1, 2, 3].map((i) => ({ ...OFFICE, from: day(i, 9), to: day(i, 17) }));
const visits = [...nights, ...workdays];

describe('offering to name a frequent spot', () => {
  it('guesses home for where the nights are spent', () => {
    const o = placeOffer(visits, [], [], HOME)!;
    expect(o.guess).toBe('home');
    expect(offerText(o, 'Banbury')).toBe("You're often here (near Banbury, nights). Name it?");
    expect(offerActions(o).map((a) => a.label)).toEqual(['Home', 'Work', 'Other…', 'Not now']);
  });

  it('guesses work for weekday office hours and puts Work first', () => {
    const o = placeOffer(visits, [], [], OFFICE)!;
    expect(o.guess).toBe('work');
    expect(o.when).toBe('weekdays');
    expect(offerActions(o)[0].label).toBe('Work');
  });

  it('only while the user is there, and never again once asked', () => {
    expect(placeOffer(visits, [], [], { lat: 51.5, lon: -0.1 })).toBeNull();
    expect(placeOffer(visits, [], [{ lat: 52.0605, lon: -1.3405 }], HOME)).toBeNull();
  });

  it('no guess of home once a place is called home; named spots are not offered', () => {
    const home = { id: 1, name: 'home', radiusM: 120, ...HOME };
    expect(placeOffer(visits, [home], [], HOME)).toBeNull();
    const elsewhere = { id: 2, name: 'Home', radiusM: 120, lat: 51, lon: 0 };
    expect(placeOffer(visits, [elsewhere], [], HOME)!.guess).toBeNull();
  });

  it('names the usual part of the day', () => {
    expect(usualPartOfDay([{ ...HOME, from: day(0, 18), to: day(0, 21) }])).toBe('evenings');
    expect(usualPartOfDay([{ ...HOME, from: day(0, 13), to: day(0, 16) }])).toBe('afternoons');
  });
});

import {
  bearingWord,
  distanceText,
  durationText,
  type Fix,
  findPlace,
  fixAt,
  frequentPlaces,
  likelyHome,
  type NamedPlace,
  parkedSpot,
  parseLocationQuestion,
  placeAt,
  placeEvents,
  pointInTime,
  timeAt,
  visitsFrom,
} from '@/engine/location-logic';

const MIN = 60_000;
const HOUR = 60 * MIN;
// Thu 26 Nov 2026, 16:30 local
const NOW = new Date(2026, 10, 26, 16, 30);
const base = new Date(2026, 10, 26, 0, 0).getTime();

const home = { lat: 53.8, lon: -1.55 };
const gym = { lat: 53.81, lon: -1.53 }; // ~1.7 km away
const fix = (at: number, p: { lat: number; lon: number }, extra: Partial<Fix> = {}): Fix => ({
  at,
  ...p,
  accM: 20,
  ...extra,
});

describe('parseLocationQuestion', () => {
  const p = (q: string) => parseLocationQuestion(q, NOW);
  it('names places', () => {
    expect(p('call this place the gym')).toEqual({ kind: 'name', name: 'the gym' });
    expect(p('This is home')).toEqual({ kind: 'name', name: 'home' });
    expect(p('this is my office.')).toEqual({ kind: 'name', name: 'office' });
    expect(p("this is my mum's house")).toEqual({ kind: 'name', name: "mum's house" });
    expect(p('remember this place as Sam’s flat')).toEqual({ kind: 'name', name: 'Sam’s flat' });
    expect(p('save this spot as parking')).toEqual({ kind: 'name', name: 'parking' });
  });
  it('does not take ordinary sentences as names', () => {
    expect(p('this is great')).toBeNull();
    expect(p('this is my friend Sam')).toBeNull();
    expect(p('this is a problem')).toBeNull();
  });
  it('forgets', () => {
    expect(p('forget this place')).toEqual({ kind: 'forget', name: null });
    expect(p('delete the place called gym')).toEqual({ kind: 'forget', name: 'gym' });
  });
  it('where now / parked', () => {
    expect(p('Where am I?')).toEqual({ kind: 'whereNow' });
    expect(p('what town is this')).toEqual({ kind: 'whereNow' });
    expect(p('where did I park')).toEqual({ kind: 'parked' });
    expect(p("where's my car?")).toEqual({ kind: 'parked' });
  });
  it('where was I at a time', () => {
    const q = p('where was I at 3pm yesterday?');
    expect(q?.kind).toBe('whereAt');
    expect(q && 'at' in q && new Date(q.at)).toEqual(new Date(2026, 10, 25, 15, 0));
  });
  it('leaves "where was I when …" to memory search', () => {
    expect(p('where was I when Sam called')).toBeNull();
  });
  it('last at / how long / places', () => {
    expect(p('when was I last at the gym?')).toEqual({ kind: 'lastAt', name: 'the gym' });
    expect(p('when did I last go to my office')).toEqual({ kind: 'lastAt', name: 'office' });
    expect(p('how long was I at work today?')).toEqual({ kind: 'howLong', name: 'work' });
    expect(p('where have I been this week')).toEqual({ kind: 'placesIn' });
  });
  it('ignores other questions', () => {
    expect(p('what did Sam say')).toBeNull();
    expect(p('remember that I like tea')).toBeNull();
  });
});

describe('pointInTime', () => {
  const at = (q: string) => {
    const r = pointInTime(q, NOW);
    return r && new Date(r.at);
  };
  it('reads clock times', () => {
    expect(at('at 3pm')).toEqual(new Date(2026, 10, 26, 15, 0));
    expect(at('at 15:30')).toEqual(new Date(2026, 10, 26, 15, 30));
    expect(at('at 3')).toEqual(new Date(2026, 10, 26, 15, 0)); // 15:00 has passed
    expect(at('at 9')).toEqual(new Date(2026, 10, 26, 9, 0)); // 21:00 hasn't
    expect(at('at 6pm')).toEqual(new Date(2026, 10, 25, 18, 0)); // future today → yesterday
  });
  it('reads days', () => {
    expect(at('yesterday at 3')).toEqual(new Date(2026, 10, 25, 15, 0));
    expect(at('yesterday at 9')).toEqual(new Date(2026, 10, 25, 9, 0));
    expect(at('on monday at noon')).toEqual(new Date(2026, 10, 23, 12, 0));
    expect(at('on thursday morning')).toEqual(new Date(2026, 10, 19, 9, 0)); // last week's
    expect(at('2 hours ago')).toEqual(new Date(2026, 10, 26, 14, 30));
  });
  it('null without a time', () => {
    expect(pointInTime('where was I', NOW)).toBeNull();
  });
});

describe('visits and places', () => {
  // Home overnight on 3 days, the gym for 1 h each evening.
  const fixes: Fix[] = [];
  for (let d = -3; d < 0; d++) {
    const day = base + d * 24 * HOUR;
    for (let t = 0; t < 8 * HOUR; t += 15 * MIN) fixes.push(fix(day + t, home));
    for (let t = 18 * HOUR; t < 19 * HOUR; t += 15 * MIN) fixes.push(fix(day + t, gym));
  }

  it('finds stays of 10+ minutes', () => {
    const v = visitsFrom(fixes);
    expect(v.length).toBe(6);
    expect(v[0].to - v[0].from).toBe(8 * HOUR - 15 * MIN + 20 * MIN);
  });

  it('a lone fix is not a stay', () => {
    expect(visitsFrom([fix(base, home)], 30 * MIN)).toEqual([]);
  });

  it('finds frequent places and guesses home from the nights', () => {
    const f = frequentPlaces(visitsFrom(fixes), []);
    expect(f.length).toBe(2);
    const h = likelyHome(f);
    expect(h && Math.abs(h.lat - home.lat)).toBeLessThan(0.001);
  });

  it('named places are not frequent suggestions', () => {
    const named: NamedPlace[] = [{ id: 1, name: 'the gym', ...gym, radiusM: 120 }];
    expect(frequentPlaces(visitsFrom(fixes), named).length).toBe(1);
  });

  it('time at a place', () => {
    const g: NamedPlace = { id: 1, name: 'gym', ...gym, radiusM: 120 };
    const ms = timeAt(visitsFrom(fixes), g, base - 24 * HOUR, base);
    expect(ms).toBe(HOUR - 15 * MIN + 20 * MIN);
  });
});

describe('fixAt / parking / places', () => {
  it('fixAt uses the fix before (≤ 20 min) or one shortly after', () => {
    const fs = [fix(base, home), fix(base + HOUR, gym)];
    expect(fixAt(fs, base + 10 * MIN)?.lat).toBe(home.lat);
    expect(fixAt(fs, base + 55 * MIN)?.lat).toBe(gym.lat);
    expect(fixAt(fs, base + 30 * MIN)).toBeNull();
  });

  it('parking: the latest parked mark wins', () => {
    const fs = [
      fix(base, home),
      fix(base + 5 * MIN, { lat: 53.85, lon: -1.55 }), // 5.5 km in 5 min: driving
      fix(base + 10 * MIN, gym, { speedMs: 0 }),
      fix(base + 11 * MIN, gym, { source: 'parked' }),
    ];
    expect(parkedSpot(fs)?.source).toBe('parked');
  });

  it('parking: without a mark, the stop after driving', () => {
    const stop = { lat: 53.86, lon: -1.55 };
    const fs = [
      fix(base, home),
      fix(base + 5 * MIN, { lat: 53.85, lon: -1.55 }),
      fix(base + 15 * MIN, stop, { speedMs: 0.5 }),
    ];
    expect(parkedSpot(fs)?.lat).toBe(stop.lat);
    expect(parkedSpot([fix(base, home), fix(base + HOUR, home)])).toBeNull();
  });

  it('placeAt and events', () => {
    const named: NamedPlace[] = [
      { id: 1, name: 'home', ...home, radiusM: 120 },
      { id: 2, name: 'gym', ...gym, radiusM: 120 },
    ];
    expect(placeAt({ lat: 53.8005, lon: -1.55 }, named)?.id).toBe(1);
    expect(placeAt({ lat: 53.805, lon: -1.54 }, named)).toBeNull();
    expect(placeEvents(1, named[1], named, 5).map((e) => `${e.type}:${e.place.name}`)).toEqual([
      'leave:home',
      'enter:gym',
    ]);
    expect(placeEvents(2, named[1], named, 5)).toEqual([]);
    expect(findPlace('the gym', named)?.id).toBe(2);
    expect(findPlace('my home', named)?.id).toBe(1);
  });

  it('words', () => {
    expect(bearingWord(home, { lat: 53.81, lon: -1.55 })).toBe('north');
    expect(bearingWord(home, { lat: 53.79, lon: -1.56 })).toBe('south-west');
    expect(distanceText(84)).toBe('80 m');
    expect(distanceText(1234)).toBe('1.2 km');
    expect(durationText(75 * MIN)).toBe('1 h 15 min');
    expect(durationText(2 * HOUR)).toBe('2 h');
  });
});

import {
  addSample,
  amazonHost,
  birthdayLine,
  daysUntil,
  duration,
  searchLink,
  stepsToday,
  stepsYesterday,
  uberLink,
  upcomingBirthdays,
} from '@/integrations/extras-logic';
import { parseShared, sharedComposerText } from '@/engine/share-in';

jest.mock('@/integrations/native', () => ({ integrationsNative: () => null }));

const at = (s: string) => new Date(s).getTime();

describe('steps', () => {
  const now = { at: at('2026-11-25T15:00:00'), count: 12_000 };

  it('restart today: every step since then is today', () => {
    expect(stepsToday([], now, at('2026-11-25T08:00:00'))).toEqual({
      steps: 12_000,
      since: at('2026-11-25T08:00:00'),
      from: 'restart',
    });
  });

  it('a reading just before midnight counts from midnight', () => {
    const r = stepsToday([{ at: at('2026-11-24T23:50:00'), count: 9_000 }], now, at('2026-11-20'));
    expect(r).toEqual({ steps: 3_000, since: at('2026-11-25T00:00:00'), from: 'midnight' });
  });

  it('else from the first reading today', () => {
    const r = stepsToday(
      [
        { at: at('2026-11-24T18:00:00'), count: 8_000 },
        { at: at('2026-11-25T09:00:00'), count: 9_500 },
      ],
      now,
      at('2026-11-20'),
    );
    expect(r).toEqual({ steps: 2_500, since: at('2026-11-25T09:00:00'), from: 'reading' });
  });

  it('readings from before a restart are ignored', () => {
    const r = stepsToday(
      [{ at: at('2026-11-24T23:55:00'), count: 50_000 }],
      now,
      at('2026-11-25T08:00:00'),
    );
    expect(r?.from).toBe('restart');
    expect(stepsToday([{ at: at('2026-11-21'), count: 50_000 }], now, at('2026-11-22'))).toBeNull();
  });

  it('yesterday from readings near both midnights', () => {
    const s = [
      { at: at('2026-11-23T23:45:00'), count: 1_000 },
      { at: at('2026-11-24T12:00:00'), count: 5_000 },
      { at: at('2026-11-25T00:10:00'), count: 9_000 },
    ];
    expect(stepsYesterday(s, now.at, at('2026-11-20'))).toBe(8_000);
    expect(stepsYesterday(s.slice(1), now.at, at('2026-11-20'))).toBeNull();
  });

  it('keeps one reading per 10 minutes and 3 days', () => {
    let s = addSample([], { at: at('2026-11-25T09:00:00'), count: 1 });
    s = addSample(s, { at: at('2026-11-25T09:05:00'), count: 2 });
    expect(s).toHaveLength(1);
    s = addSample(s, { at: at('2026-11-25T09:20:00'), count: 3 });
    s = addSample(s, { at: at('2026-11-25T09:25:00'), count: 4 });
    expect(s.map((x) => x.count)).toEqual([1, 4]);
    s = addSample(s, { at: at('2026-11-29T09:00:00'), count: 5 });
    expect(s.map((x) => x.count)).toEqual([5]);
  });
});

describe('birthdays', () => {
  const now = new Date('2026-11-25T10:00:00');
  const list = [
    { name: 'Sam Taylor', month: 11, day: 27, year: 1990 },
    { name: 'Jo', month: 1, day: 3 },
    { name: 'Ana', month: 11, day: 25 },
  ];
  it('days until and lines', () => {
    expect(daysUntil(list[0], now)).toBe(2);
    expect(daysUntil(list[2], now)).toBe(0);
    expect(birthdayLine(list[0], now)).toBe('Sam Taylor (turning 36) on 27 November, in 2 days');
    expect(birthdayLine(list[2], now)).toBe('Ana today');
  });
  it('next, this week, this month', () => {
    expect(upcomingBirthdays(list, 'next', now).map((b) => b.name)).toEqual(['Ana']);
    expect(upcomingBirthdays(list, 'week', now).map((b) => b.name)).toEqual(['Ana', 'Sam Taylor']);
    expect(upcomingBirthdays(list, 'month', now)).toHaveLength(2);
  });
});

describe('links', () => {
  it('search links per app', () => {
    expect(searchLink('youtube', 'pasta recipe').app).toBe(
      'https://www.youtube.com/results?search_query=pasta%20recipe',
    );
    expect(searchLink('spotify', 'jazz').app).toBe('spotify:search:jazz');
    expect(searchLink('amazon', 'shoes', 'en-GB').app).toBe('https://www.amazon.co.uk/s?k=shoes');
    expect(searchLink('waze', 'work').app).toBe('https://waze.com/ul?q=work&navigate=yes');
    expect(searchLink('maps', 'cafe').app).toBe('geo:0,0?q=cafe');
  });
  it('amazon by region', () => {
    expect(amazonHost('de-DE')).toBe('amazon.de');
    expect(amazonHost('en')).toBe('amazon.com');
  });
  it('uber with and without a destination', () => {
    expect(uberLink('Kings Cross')).toBe(
      'https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=Kings%20Cross',
    );
    expect(uberLink(null)).toBe('https://m.uber.com/ul/?action=setPickup&pickup=my_location');
  });
  it('durations', () => {
    expect(duration(30_000)).toBe('under a minute');
    expect(duration(42 * 60_000)).toBe('42 min');
    expect(duration(72 * 60_000)).toBe('1 h 12 min');
  });
});

describe('share in', () => {
  it('parses and builds composer text', () => {
    expect(parseShared('{"text":"https://x.org","subject":"A page","at":1}')).toEqual({
      text: 'https://x.org',
      subject: 'A page',
      at: 1,
    });
    expect(parseShared('{"at":1}')).toBeNull();
    expect(parseShared('nope')).toBeNull();
    expect(sharedComposerText({ text: 'https://x.org', subject: 'A page', at: 1 })).toBe(
      'A page\nhttps://x.org',
    );
    expect(sharedComposerText({ text: 'hello', at: 1 })).toBe('hello');
  });
});

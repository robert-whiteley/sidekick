import {
  cacheKey,
  describeForecast,
  forecastUrl,
  MET_USER_AGENT,
  parseForecast,
  parseWeatherQuestion,
  symbolWords,
} from '@/web/weather-logic';
import { _clearWeatherCache, getForecast } from '@/web/weather';

jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));
const mockKv = new Map<string, string>();
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    kvGet: (k: string) => mockKv.get(k) ?? null,
    kvSet: (k: string, v: string | null) => (v == null ? mockKv.delete(k) : mockKv.set(k, v)),
  },
}));

const NOW = new Date(2026, 10, 26, 10, 0);
const iso = (h: number, day = 26) => new Date(2026, 10, day, h).toISOString();

function series(rainHours: number[], symbol = 'partlycloudy_day', day = 26) {
  return {
    properties: {
      timeseries: Array.from({ length: 24 }, (_, h) => ({
        time: iso(h, day),
        data: {
          instant: { details: { air_temperature: 8 + (h > 12 ? 4 : h / 3), wind_speed: 3 } },
          next_1_hours: rainHours.includes(h)
            ? { summary: { symbol_code: 'rain' }, details: { precipitation_amount: 1.2 } }
            : { summary: { symbol_code: symbol }, details: { precipitation_amount: 0 } },
        },
      })),
    },
  };
}

describe('parseWeatherQuestion', () => {
  it('spots weather questions', () => {
    expect(parseWeatherQuestion("what's the weather like?")).toEqual({
      when: 'today',
      rain: false,
      town: null,
    });
    expect(parseWeatherQuestion('will it rain tomorrow?')).toEqual({
      when: 'tomorrow',
      rain: true,
      town: null,
    });
    expect(parseWeatherQuestion('do I need an umbrella this afternoon')?.rain).toBe(true);
    expect(parseWeatherQuestion('weather in Paris tomorrow')).toEqual({
      when: 'tomorrow',
      rain: false,
      town: 'paris',
    });
    expect(parseWeatherQuestion('forecast for saturday')?.when).toBe(6);
    expect(parseWeatherQuestion("what's the temperature outside")?.when).toBe('now');
  });
  it('ignores the rest', () => {
    expect(parseWeatherQuestion('what did Sam say')).toBeNull();
    expect(parseWeatherQuestion('open the weather app')).toBeNull();
  });
});

describe('forecast words', () => {
  it('symbol words', () => {
    expect(symbolWords('lightrainshowersandthunder_day')).toBe('light rain showers and thunder');
    expect(symbolWords('partlycloudy_night')).toBe('partly cloudy');
    expect(symbolWords('heavysnow')).toBe('heavy snow');
    expect(symbolWords('lightssleetshowers_day')).toBe('light sleet showers');
  });

  it('rounds coordinates to about 1 km', () => {
    expect(forecastUrl(53.80123, -1.54876)).toBe(
      'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=53.80&lon=-1.55',
    );
    expect(cacheKey(53.80123, -1.54876)).toBe('53.80,-1.55');
  });

  it('describes rain', () => {
    const f = parseForecast(series([15, 16, 17]))!;
    const t = describeForecast(f, { when: 'today', rain: true, town: null }, NOW, {
      place: 'Leeds',
    });
    expect(t).toMatch(/^Yes: rain from about 15:00 to 18:00\./);
    expect(t).toContain('Today in Leeds: partly cloudy');
  });

  it('says no rain', () => {
    const f = parseForecast(series([]))!;
    const t = describeForecast(f, { when: 'today', rain: true, town: null }, NOW);
    expect(t).toMatch(/^No, no rain expected today\./);
  });

  it('Fahrenheit for the US', () => {
    const f = parseForecast(series([]))!;
    expect(
      describeForecast(f, { when: 'now', rain: false, town: null }, NOW, { fahrenheit: true }),
    ).toMatch(/°F/);
  });

  it('no data for the time asked', () => {
    const f = parseForecast(series([]))!;
    expect(describeForecast(f, { when: 'tomorrow', rain: false, town: null }, NOW)).toMatch(
      /don't have a forecast/,
    );
  });
});

describe('getForecast', () => {
  beforeEach(() => {
    mockKv.clear();
    _clearWeatherCache();
  });

  const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => headers[k] ?? null },
      json: async () => body,
    }) as unknown as Response;

  it('sends the app user agent and caches until Expires', async () => {
    const now = Date.parse('2026-11-26T10:00:00Z');
    const doFetch = jest.fn(async () =>
      res(200, series([]), {
        Expires: 'Thu, 26 Nov 2026 10:30:00 GMT',
        'Last-Modified': 'Thu, 26 Nov 2026 09:55:00 GMT',
      }),
    );
    expect(await getForecast(53.8, -1.55, doFetch as unknown as typeof fetch, now)).not.toBeNull();
    const [, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(MET_USER_AGENT);
    await getForecast(53.801, -1.551, doFetch as unknown as typeof fetch, now + 60_000);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('re-checks with If-Modified-Since and keeps the data on 304', async () => {
    const now = Date.parse('2026-11-26T10:00:00Z');
    const first = jest.fn(async () =>
      res(200, series([]), {
        Expires: 'Thu, 26 Nov 2026 10:30:00 GMT',
        'Last-Modified': 'Thu, 26 Nov 2026 09:55:00 GMT',
      }),
    );
    await getForecast(53.8, -1.55, first as unknown as typeof fetch, now);
    const again = jest.fn(async () => res(304, null, { Expires: 'Thu, 26 Nov 2026 11:30:00 GMT' }));
    const f = await getForecast(53.8, -1.55, again as unknown as typeof fetch, now + HOUR);
    expect(f?.steps.length).toBe(24);
    const [, init] = again.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['If-Modified-Since']).toBe(
      'Thu, 26 Nov 2026 09:55:00 GMT',
    );
  });

  it('null when offline with nothing cached', async () => {
    const fail = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await getForecast(1, 2, fail as unknown as typeof fetch)).toBeNull();
  });
});

const HOUR = 3_600_000;

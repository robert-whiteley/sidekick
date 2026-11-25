/**
 * Weather from MET Norway's Locationforecast 2.0 (free, CC BY 4.0 / NLOD 2.0, commercial use
 * allowed with credit "Based on data from MET Norway"). Pure parsing and wording; tested in
 * __tests__/weather-logic-test.ts. Network in weather.ts, only when Online lookup is on.
 */

export const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
/** MET requires an identifying User-Agent with a website (no personal details). */
export const MET_USER_AGENT = 'Sidekick/1.0 https://sidekick.sashy.ai';
export const MET_CREDIT = 'Based on data from MET Norway';
export const MET_SOURCE_URL = 'https://api.met.no/';

/** About 1 km: enough for a forecast, not an exact position (MET allows up to 4 decimals). */
export function roundCoord(x: number): number {
  return Math.round(x * 100) / 100;
}

export function forecastUrl(lat: number, lon: number): string {
  return `${MET_URL}?lat=${roundCoord(lat).toFixed(2)}&lon=${roundCoord(lon).toFixed(2)}`;
}

// --- Questions ---

export type WeatherWhen = 'now' | 'today' | 'later' | 'afternoon' | 'evening' | 'tomorrow' | number;

export type WeatherQuestion = {
  when: WeatherWhen;
  /** "will it rain", "do I need an umbrella": answer yes/no about rain first. */
  rain: boolean;
  /** "weather in Paris": a town name as said. */
  town: string | null;
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseWeatherQuestion(q: string): WeatherQuestion | null {
  const s = q.toLowerCase().replace(/[’]/g, "'");
  const rain =
    /\b((will|is|does|did) it (going to |gonna )?(rain|be (wet|rainy)|shower|pour|drizzle)|rain(ing|y)? (today|tomorrow|later|tonight|this)|(need|bring|take|pack) (an? |my )?(umbrella|brolly|raincoat|rain jacket))\b/.test(
      s,
    );
  const weather =
    rain ||
    /\b(weather|forecast|(will|is) it (going to )?(snow|be (sunny|windy|cold|hot|warm|nice|dry|freezing|icy))|how (hot|cold|warm|windy) (is it|will it be|is it going to be)|what('s| is) the temperature( outside)?|temperature (outside|today|tomorrow)|(need|bring|take) (an? |my )?(coat|jacket|sun ?cream|sunscreen))\b/.test(
      s,
    );
  if (!weather) return null;
  // Not about the weather here: "what's the weather like on Mars", "weather app".
  if (/\b(weather app|on mars|climate)\b/.test(s)) return null;
  let when: WeatherWhen = 'today';
  if (/\btomorrow\b/.test(s)) when = 'tomorrow';
  else if (/\b(tonight|this evening)\b/.test(s)) when = 'evening';
  else if (/\bthis afternoon\b/.test(s)) when = 'afternoon';
  else if (/\b(later|next few hours|in an hour|in a few hours)\b/.test(s)) when = 'later';
  else if (/\b(right now|now|outside|at the moment|currently)\b/.test(s) && !rain) when = 'now';
  else {
    const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(s));
    if (wd >= 0) when = wd;
  }
  const town =
    /\b(?:in|for|at|near) ((?:[a-z][a-z'.-]*)(?: [a-z][a-z'.-]*){0,2}?)(?:,? (?:today|tomorrow|tonight|this|on|at|later|right now|now|next)\b|\?|$)/.exec(
      s.replace(/[?!.]+$/, ''),
    )?.[1] ?? null;
  const notTown =
    /^(the (morning|afternoon|evening|week|weekend)|a (bit|while|few|minute)|an hour|the next|here|my area|the area)$/;
  return { when, rain, town: town && !notTown.test(town) ? town : null };
}

// --- Forecast ---

type Step = {
  time: string;
  data: {
    instant: { details: { air_temperature?: number; wind_speed?: number } };
    next_1_hours?: {
      summary?: { symbol_code?: string };
      details?: { precipitation_amount?: number };
    };
    next_6_hours?: {
      summary?: { symbol_code?: string };
      details?: { precipitation_amount?: number };
    };
  };
};

export type Forecast = { steps: Step[] };

/** The timeseries of a compact response, or null when it isn't one. */
export function parseForecast(json: unknown): Forecast | null {
  const steps = (json as { properties?: { timeseries?: Step[] } })?.properties?.timeseries;
  if (!Array.isArray(steps) || !steps.length) return null;
  return { steps: steps.filter((x) => x?.time && x?.data?.instant?.details) };
}

/** MET symbol code → words: "lightrainshowersandthunder_day" → "light rain showers and thunder". */
export function symbolWords(code: string | undefined): string {
  if (!code) return '';
  const c = code.replace(/_(day|night|polartwilight)$/, '');
  const fixed: Record<string, string> = {
    clearsky: 'clear',
    fair: 'mostly clear',
    partlycloudy: 'partly cloudy',
    cloudy: 'cloudy',
    fog: 'foggy',
  };
  if (fixed[c]) return fixed[c];
  return c
    .replace(/^(light|heavy)ssleet/, '$1 sleet')
    .replace(/(light|heavy)/, '$1 ')
    .replace(/(rain|sleet|snow)(showers)?/, (_m, a, b) => `${a}${b ? ' showers' : ''}`)
    .replace(/andthunder$/, ' and thunder')
    .replace(/\s+/g, ' ')
    .trim();
}

const wet = (code?: string) => !!code && /rain|sleet|snow|drizzle/.test(code);

type Hour = {
  at: number;
  temp: number | null;
  wind: number | null;
  rainMm: number;
  symbol?: string;
};

function hours(f: Forecast): Hour[] {
  return f.steps.map((s) => {
    const one = s.data.next_1_hours;
    const six = s.data.next_6_hours;
    const rainMm =
      one?.details?.precipitation_amount ?? (six?.details?.precipitation_amount ?? 0) / 6;
    return {
      at: Date.parse(s.time),
      temp: s.data.instant.details.air_temperature ?? null,
      wind: s.data.instant.details.wind_speed ?? null,
      rainMm,
      symbol: one?.summary?.symbol_code ?? six?.summary?.symbol_code,
    };
  });
}

const HOUR = 3_600_000;

/** The time span a question is about. */
export function spanFor(when: WeatherWhen, now: Date): { from: number; to: number; label: string } {
  const day = (add: number, h: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, h).getTime();
  const t = now.getTime();
  switch (when) {
    case 'now':
      return { from: t - HOUR, to: t + 2 * HOUR, label: 'now' };
    case 'later':
      return { from: t, to: t + 6 * HOUR, label: 'in the next few hours' };
    case 'afternoon':
      return { from: Math.max(t, day(0, 12)), to: day(0, 18), label: 'this afternoon' };
    case 'evening':
      return { from: Math.max(t, day(0, 17)), to: day(1, 0), label: 'this evening' };
    case 'tomorrow':
      return { from: day(1, 6), to: day(1, 22), label: 'tomorrow' };
    case 'today': {
      // Late in the evening "today" means the rest of the night.
      const end = now.getHours() >= 20 ? day(1, 6) : day(1, 0);
      return { from: t - HOUR, to: end, label: now.getHours() >= 20 ? 'tonight' : 'today' };
    }
    default: {
      let add = (when - now.getDay() + 7) % 7;
      if (add === 0) add = 7;
      const name = WEEKDAYS[when];
      return {
        from: day(add, 6),
        to: day(add, 22),
        label: `on ${name[0].toUpperCase()}${name.slice(1)}`,
      };
    }
  }
}

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
};

/**
 * One or two spoken sentences. `fahrenheit` for the US; wind in mph for GB/US, else km/h.
 * [place]: "in Leeds", shown when known.
 */
export function describeForecast(
  f: Forecast,
  q: WeatherQuestion,
  now: Date,
  opts: { place?: string | null; fahrenheit?: boolean; mph?: boolean } = {},
): string {
  const span = spanFor(q.when, now);
  const hs = hours(f).filter((h) => h.at >= span.from && h.at < span.to);
  const where = opts.place ? ` in ${opts.place}` : '';
  if (!hs.length) return `I don't have a forecast${where} for ${span.label} yet.`;
  const deg = (c: number) =>
    opts.fahrenheit ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`;
  const temps = hs.map((h) => h.temp).filter((x): x is number => x != null);
  const hi = Math.max(...temps);
  const lo = Math.min(...temps);
  const rainy = hs.filter((h) => h.rainMm >= 0.1 || (wet(h.symbol) && h.rainMm > 0));
  const counts = new Map<string, number>();
  for (const h of hs) {
    const w = symbolWords(h.symbol);
    if (w && !wet(h.symbol)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const sky = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const windMax = Math.max(0, ...hs.map((h) => h.wind ?? 0));
  const windy =
    windMax >= 10
      ? ` Windy, up to ${opts.mph ? `${Math.round(windMax * 2.237)} mph` : `${Math.round(windMax * 3.6)} km/h`}.`
      : '';

  let rainText: string;
  if (!rainy.length) rainText = `No rain expected ${span.label}.`;
  else {
    const kind = /snow/.test(rainy.map((h) => h.symbol).join(' '))
      ? 'snow'
      : /sleet/.test(rainy.map((h) => h.symbol).join(' '))
        ? 'sleet'
        : 'rain';
    const first = rainy[0].at;
    const lastH = rainy[rainy.length - 1].at;
    const total = rainy.reduce((s, h) => s + h.rainMm, 0);
    const heavy =
      Math.max(...rainy.map((h) => h.rainMm)) >= 4 ? 'heavy ' : total < 1 ? 'light ' : '';
    const time =
      first <= now.getTime() + HOUR && q.when !== 'tomorrow' && typeof q.when !== 'number'
        ? lastH > first
          ? `now until about ${hhmm(lastH + HOUR)}`
          : 'for the next hour'
        : lastH > first
          ? `from about ${hhmm(first)} to ${hhmm(lastH + HOUR)}`
          : `around ${hhmm(first)}`;
    rainText = `${q.rain ? 'Yes: ' : ''}${heavy}${kind} ${time}${span.label === 'today' || span.label === 'tonight' ? '' : ` ${span.label}`}.`;
    rainText = rainText[0].toUpperCase() + rainText.slice(1);
  }
  if (q.rain && !rainy.length) rainText = `No, ${rainText[0].toLowerCase()}${rainText.slice(1)}`;

  if (q.when === 'now') {
    const cur = hs.reduce((a, b) =>
      Math.abs(b.at - now.getTime()) < Math.abs(a.at - now.getTime()) ? b : a,
    );
    const words = symbolWords(cur.symbol);
    return `Now${where}: ${cur.temp != null ? deg(cur.temp) : ''}${words ? `, ${words}` : ''}. ${rainy.length ? rainText : ''}${windy}`
      .replace(/\s+/g, ' ')
      .trim();
  }
  const range = temps.length
    ? hi - lo >= 2
      ? `${deg(lo)} to ${deg(hi)}`
      : `around ${deg((hi + lo) / 2)}`
    : '';
  const head = `${span.label[0].toUpperCase()}${span.label.slice(1)}${where}: ${[sky, range].filter(Boolean).join(', ')}.`;
  return q.rain ? `${rainText} ${head}${windy}` : `${head} ${rainText}${windy}`;
}

/** Response caching (MET: never ask again before Expires; send If-Modified-Since). */
export type CachedForecast = {
  key: string;
  expires: number;
  lastModified: string | null;
  json: unknown;
};

export function cacheKey(lat: number, lon: number): string {
  return `${roundCoord(lat).toFixed(2)},${roundCoord(lon).toFixed(2)}`;
}

/** Expires header → ms; missing or bad → 30 minutes from now. */
export function expiresAt(header: string | null, now: number): number {
  const t = header ? Date.parse(header) : NaN;
  return Number.isFinite(t) ? t : now + 30 * 60_000;
}

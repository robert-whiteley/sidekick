/**
 * Weather lookups (MET Norway), only when Online lookup is on. Sends the position rounded to
 * 2 decimals (about 1 km) and an app User-Agent; nothing else. Cached until the response's
 * Expires time, then re-checked with If-Modified-Since (MET's terms).
 */
import { getNetworkStateAsync } from 'expo-network';

import SidekickNative from '../../modules/sidekick-native';
import {
  cacheKey,
  type CachedForecast,
  expiresAt,
  forecastUrl,
  MET_USER_AGENT,
  parseForecast,
  type Forecast,
} from './weather-logic';

const KV = 'weather.cache.v1';
const TIMEOUT_MS = 6000;
let mem: CachedForecast | null = null;

function cached(key: string): CachedForecast | null {
  if (mem?.key === key) return mem;
  try {
    const raw = SidekickNative.kvGet(KV);
    const c = raw ? (JSON.parse(raw) as CachedForecast) : null;
    return c?.key === key ? (mem = c) : null;
  } catch {
    return null;
  }
}

function store(c: CachedForecast) {
  mem = c;
  try {
    SidekickNative.kvSet(KV, JSON.stringify(c));
  } catch {
    // Cache is optional.
  }
}

export async function online(): Promise<boolean> {
  try {
    const s = await getNetworkStateAsync();
    return s.isConnected !== false && s.isInternetReachable !== false;
  } catch {
    return true;
  }
}

/** The forecast for a position, or null (offline, refused, or a bad answer). */
export async function getForecast(
  lat: number,
  lon: number,
  doFetch: typeof fetch = fetch,
  now = Date.now(),
): Promise<Forecast | null> {
  const key = cacheKey(lat, lon);
  const c = cached(key);
  if (c && now < c.expires) return parseForecast(c.json);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': MET_USER_AGENT,
    };
    if (c?.lastModified) headers['If-Modified-Since'] = c.lastModified;
    const res = await doFetch(forecastUrl(lat, lon), {
      headers,
      signal: ctl.signal,
      credentials: 'omit',
    });
    const exp = expiresAt(res.headers.get('Expires'), now);
    if (res.status === 304 && c) {
      store({ ...c, expires: exp });
      return parseForecast(c.json);
    }
    if (!res.ok) return c ? parseForecast(c.json) : null;
    const json = await res.json();
    store({ key, expires: exp, lastModified: res.headers.get('Last-Modified'), json });
    return parseForecast(json);
  } catch {
    // Offline or timed out: an older forecast is better than none.
    return c ? parseForecast(c.json) : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Test hook. */
export function _clearWeatherCache() {
  mem = null;
}

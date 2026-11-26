/**
 * Location memory at runtime: records where the phone is while Sidekick listens or is open,
 * answers "where am I / where was I / where did I park / when was I last at the gym / how long
 * at work", names places by voice, and gives the weather (online lookup only).
 *
 * For routines: `onPlaceChange(listener)` reports entering and leaving places the user named
 * ({ type: 'enter' | 'leave', place, at }). It fires while Sidekick runs (listening or open) and
 * a new position arrives (at most every few minutes); not while the app is fully closed. Use
 * `currentNamedPlace()` for the place the phone is in now.
 *
 * Privacy: positions stay in the encrypted database. Only two things go online, and only with
 * Online lookup on: the position rounded to ~1 km for a weather question (MET Norway), and a
 * street-name lookup through Android's Geocoder for "where am I" / "where did I park".
 */
import { AppState } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { CAR_NAME, NOT_CAR } from './hands-free-logic';
import { carConnected } from './hands-free';
import {
  atPhrase,
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
  timeAt,
  visitsFrom,
  whenText,
} from './location-logic';
import {
  allPlaces,
  hasLocationPermission as hasPermission,
  locationMemoryOn,
  noteFix,
  refreshPlaces,
} from './location-track';
import { geoPack } from './geo';
import { maybeOfferPlaceName } from './place-naming';
import { queueOnline } from './online-queue';
import { packFind } from './geo-pack';
import { haversineM, type LatLon } from './place-logic';
import { askLocationPermission, currentRegion, placeName } from './places';
import { platformText } from './platform-text';
import { getSettings } from './settings';
import { parseTimeRange } from '@/memory/time-range';
import { deletePlace, fixesBetween, namePlace, pruneTrack } from '@/memory/places-store';
import {
  describeForecast,
  MET_CREDIT,
  MET_SOURCE_URL,
  parseWeatherQuestion,
} from '@/web/weather-logic';
import { forecastUnreachable, getForecast, online } from '@/web/weather';
import type { WebSource } from '@/web/lookup-logic';

const DAY = 86_400_000;

function freshFix(maxAgeMs: number): Fix | null {
  try {
    const l = SidekickNative.lastLocation();
    if (!l || Date.now() - l.at > maxAgeMs) return null;
    return { lat: l.lat, lon: l.lon, at: l.at, accM: l.accuracyM };
  } catch {
    return null;
  }
}

/** The position now: a fix ≤ 10 min old, waiting up to 4 s for a new one. */
async function fixNow(): Promise<Fix | null> {
  const ok = freshFix(10 * 60_000);
  if (ok) return ok;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const f = freshFix(10 * 60_000);
    if (f) return f;
  }
  return freshFix(2 * 3_600_000);
}

/**
 * Runs while the app is open: records the position every 5 minutes (the listening service
 * records its own), marks where the car was left when its Bluetooth goes, and trims old fixes to
 * the memory keep period. Returns a stop function.
 */
export function startLocationMemory(): () => void {
  try {
    SidekickNative.placesSetCarPattern?.(`^(?!.*${NOT_CAR.source}).*${CAR_NAME.source}`);
  } catch {
    // Older native build.
  }
  let car = carConnected();
  const tick = () => {
    if (AppState.currentState !== 'active' || !locationMemoryOn()) return;
    const f = freshFix(10 * 60_000);
    if (f)
      void noteFix(f)
        .then(() => maybeOfferPlaceName(f))
        .catch(() => false);
  };
  const carTick = () => {
    const nowCar = carConnected();
    if (car && !nowCar && locationMemoryOn()) {
      const f = freshFix(5 * 60_000);
      if (f) void noteFix({ ...f, at: Date.now(), source: 'parked' }).catch(() => false);
    }
    car = nowCar;
  };
  tick();
  void pruneTrack(getSettings().retentionDays).catch(() => {});
  const t1 = setInterval(tick, 5 * 60_000);
  const t2 = setInterval(carTick, 30_000);
  return () => {
    clearInterval(t1);
    clearInterval(t2);
  };
}

// --- Words for a position ---

const town = (p: LatLon) => placeName(p)?.split(',')[0] ?? null;

async function street(p: LatLon): Promise<string | null> {
  if (!getSettings().webLookup || !(await online())) return null;
  try {
    return (await SidekickNative.reverseGeocode?.(p.lat, p.lon)) ?? null;
  } catch {
    return null;
  }
}

/** "at home", "at the gym", "on Park Row, Leeds", "in Leeds", "near 53.80, -1.55". */
async function where(p: Fix | LatLon, withStreet: boolean): Promise<string> {
  const named = placeAt(p, await allPlaces());
  if (named) return `at ${atPhrase(named.name)}`;
  if (withStreet) {
    const st = await street(p);
    if (st) return `on ${st}`;
  }
  const t = town(p);
  if (t) return `in ${t}`;
  return `near ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
}

// --- Answers ---

export type LocationAnswer = {
  text: string;
  web?: WebSource[];
  /** Kept until the internet works (online-queue.ts); a back-online run tries again later. */
  waitingOnline?: boolean;
  /** Nothing recorded for this question: memory notes may still answer it (assistant.ts). */
  empty?: boolean;
};

const OFF = 'Location memory is off. Turn it on in Settings → Privacy → Location.';
const notRecorded = () => platformText('locationNotRecorded');

async function needPermission(): Promise<string | null> {
  if (hasPermission()) return null;
  const ok = await askLocationPermission().catch(() => false);
  return ok
    ? null
    : 'I need location access for that. You can allow it in Settings → Privacy → Location.';
}

/** Answers a location or weather question, or null when it isn't one. */
export async function answerLocation(
  question: string,
  opts: { offRecord?: boolean; now?: Date } = {},
): Promise<LocationAnswer | null> {
  const now = opts.now ?? new Date();
  const weather = parseWeatherQuestion(question);
  // Off the record nothing is kept, so an offline forecast isn't queued either.
  if (weather) return weatherAnswer(weather, now, opts.offRecord ? null : question);
  const q = parseLocationQuestion(question, now);
  if (!q) return null;

  const history = q.kind !== 'whereNow';
  const perm = await needPermission();
  if (perm) return { text: perm, empty: history };
  if (history && getSettings().locationMemory === false) return { text: OFF, empty: true };

  switch (q.kind) {
    case 'whereNow': {
      const f = await fixNow();
      if (!f) return { text: "I can't get your location right now. Is location turned on?" };
      void noteFix(f).catch(() => false);
      const w = await where(f, true);
      const t = town(f);
      const also = w.startsWith('at ') && t ? ` (${t})` : '';
      const freq = !w.startsWith('at ')
        ? frequentPlaces(
            visitsFrom(await fixesBetween(now.getTime() - 60 * DAY, now.getTime())),
            await allPlaces(),
          ).find((x) => haversineM(x, f) <= 150)
        : undefined;
      const hint = freq
        ? ` You've been here on ${freq.days} days; say "call this place …" to name it.`
        : '';
      return { text: `You're ${w}${also}.${hint}` };
    }
    case 'name': {
      if (opts.offRecord)
        return {
          text: "You're off the record, so I won't save places. Leave Off the record and say it again.",
        };
      const f = await fixNow();
      if (!f)
        return { text: "I can't get your location right now, so I couldn't save this place." };
      const p = await namePlace(q.name, f);
      refreshPlaces(p.id);
      return { text: `Saved this spot as ${p.name}. Try "when was I last at ${p.name}?"` };
    }
    case 'forget': {
      const all = await allPlaces();
      const f = q.name ? null : await fixNow();
      const p = q.name ? findPlace(q.name, all) : f ? placeAt(f, all) : null;
      if (!p)
        return {
          text: q.name ? `I don't have a place called ${q.name}.` : "This isn't a place you named.",
        };
      await deletePlace(p.id);
      refreshPlaces();
      return { text: `Forgot ${p.name}.` };
    }
    case 'parked': {
      const fixes = await fixesBetween(now.getTime() - 3 * DAY, now.getTime() + 1);
      const spot = parkedSpot(fixes);
      if (!spot) return { text: platformText('parkingUnknown'), empty: true };
      const w = await where(spot, true);
      const me = await fixNow();
      const when = whenText(spot.at, now);
      if (me) {
        const d = haversineM(me, spot);
        if (d < 40) return { text: `You're right by where you parked (${when}).` };
        return {
          text: `Your car is about ${distanceText(d)} ${bearingWord(me, spot)} of here, ${w} (parked ${when}).`,
        };
      }
      return { text: `You parked ${w}, ${when}.` };
    }
    case 'whereAt': {
      const fixes = await fixesBetween(q.at - DAY / 24, q.at + DAY / 24);
      const f = fixAt(fixes, q.at);
      if (!f) return { text: notRecorded(), empty: true };
      return { text: `${cap(q.label)} you were ${await where(f, false)}.` };
    }
    case 'lastAt': {
      const target = await placeTarget(q.name);
      if (!target) return null; // not a known place: memory search answers it
      const fixes = await fixesBetween(now.getTime() - 90 * DAY, now.getTime() + 1);
      const inside = fixes.filter(
        (f) => f.source !== 'parked' && haversineM(f, target) <= target.radiusM,
      );
      if (!inside.length)
        return { text: `I don't have you at ${target.name} in the last 3 months.` };
      const visits = visitsFrom(fixes).filter((v) => haversineM(v, target) <= target.radiusM + 50);
      const lastV = visits[visits.length - 1];
      const lastFix = inside[inside.length - 1];
      if (lastV && lastV.to >= lastFix.at - 60_000)
        return {
          text: `You were last at ${atPhrase(target.name)} ${whenText(lastV.from, now)}, for ${durationText(lastV.to - lastV.from)}.`,
        };
      return { text: `You were last at ${atPhrase(target.name)} ${whenText(lastFix.at, now)}.` };
    }
    case 'howLong': {
      const target = await placeTarget(q.name);
      if (!target) return null;
      const range = parseTimeRange(question, now) ?? {
        from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
        to: now.getTime(),
        label: 'today',
      };
      const to = Math.min(range.to, now.getTime());
      const visits = visitsFrom(await fixesBetween(range.from - DAY / 2, to));
      const ms = timeAt(visits, target, range.from, to);
      if (ms < 60_000)
        return { text: `I don't see you at ${atPhrase(target.name)} ${range.label}.` };
      return { text: `About ${durationText(ms)} at ${atPhrase(target.name)} ${range.label}.` };
    }
    case 'placesIn': {
      const range = parseTimeRange(question, now) ?? {
        from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
        to: now.getTime(),
        label: 'today',
      };
      const to = Math.min(range.to, now.getTime());
      const visits = visitsFrom(await fixesBetween(range.from, to));
      if (!visits.length)
        return { text: `I don't have any places for ${range.label}.`, empty: true };
      const stays: { w: string; from: number; to: number }[] = [];
      for (const v of visits) {
        const w = (await where(v, false)).replace(/^(at|in|near) /, '');
        const prev = stays[stays.length - 1];
        if (prev?.w === w) prev.to = v.to;
        else stays.push({ w, from: v.from, to: v.to });
      }
      const parts = stays.map((x) => `${x.w} (${hm(x.from)}–${hm(x.to)})`);
      const shown = parts.slice(-12);
      return { text: `${cap(range.label)}: ${shown.join(', ')}.` };
    }
  }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const hm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** A named place, "home" guessed from nights, or a town from the built-in list (10 km circle). */
async function placeTarget(name: string): Promise<NamedPlace | null> {
  const all = await allPlaces();
  const named = findPlace(name, all);
  if (named) return named;
  if (/^home$/i.test(name.replace(/^(my|the) /i, ''))) {
    const now = Date.now();
    const home = likelyHome(
      frequentPlaces(visitsFrom(await fixesBetween(now - 60 * DAY, now)), all),
    );
    if (home) return { id: -1, name: 'home', lat: home.lat, lon: home.lon, radiusM: 150 };
  }
  const t = findTown(name);
  return t ? { id: -2, name: t.name, lat: t.lat, lon: t.lon, radiusM: 10_000 } : null;
}

// --- Towns by name (the offline GeoNames list) ---

/** The biggest town or village with that name in the offline list, or null. */
export function findTown(name: string): { name: string; lat: number; lon: number } | null {
  const g = geoPack();
  const t = g ? packFind(g, name) : null;
  return t ? { name: t.name, lat: t.lat, lon: t.lon } : null;
}

// --- Weather ---

async function weatherAnswer(
  q: NonNullable<ReturnType<typeof parseWeatherQuestion>>,
  now: Date,
  question: string | null,
): Promise<LocationAnswer> {
  if (!getSettings().webLookup)
    return {
      text: 'The weather needs Online lookup (Settings → Online lookup). It sends only your rough location, to about 1 km, to MET Norway.',
    };
  let pos: LatLon | null = null;
  let placeLabel: string | null = null;
  if (q.town) {
    const t = findTown(q.town);
    if (t) [pos, placeLabel] = [t, t.name];
  }
  if (!pos) {
    if (!hasPermission()) {
      const perm = await needPermission();
      if (perm) return { text: 'Allow location, or say a town ("weather in Leeds").' };
    }
    pos = await fixNow();
    if (pos) placeLabel = town(pos);
  }
  if (!pos)
    return { text: 'I can\'t get your location right now. Say a town, like "weather in Leeds".' };
  // Offline: kept and answered when the phone is back online (online-queue.ts).
  const offline = (): LocationAnswer =>
    question
      ? { text: queueOnline('weather', question, now.getTime()), waitingOnline: true }
      : { text: "There's no internet right now, so I can't get the forecast." };
  if (!(await online())) return offline();
  const f = await getForecast(pos.lat, pos.lon);
  // Android says online but no server answered: the same as offline.
  if (!f && forecastUnreachable()) return offline();
  if (!f) return { text: "I couldn't get the forecast just now. Try again in a minute." };
  const country = q.town ? null : currentRegion().country;
  const text = describeForecast(f, q, now, {
    place: placeLabel,
    fahrenheit: country === 'US',
    mph: country === 'US' || country === 'GB',
  });
  return {
    text,
    web: [
      {
        name: 'MET Norway',
        title: 'Weather forecast (Locationforecast)',
        url: MET_SOURCE_URL,
        text,
        licence: `${MET_CREDIT} (CC BY 4.0)`,
      },
    ],
  };
}

export { currentNamedPlace, locationMemoryOn, noteFix, onPlaceChange } from './location-track';

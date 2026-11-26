/**
 * Phone extras, the pure part: which request it is (battery, storage, steps, screen time,
 * clipboard, find my phone, birthdays, a ride, navigating with Waze, searching in an app),
 * the step count for today from the phone's step counter, and links for other apps.
 * Run by extras.ts. Tested in __tests__/extras-test.ts.
 */

export type ScreenRange = 'today' | 'yesterday' | 'week';

export type Extra =
  | { type: 'battery' }
  | { type: 'storage' }
  | { type: 'steps'; day: 'today' | 'yesterday' }
  | { type: 'screenTime'; app: string | null; range: ScreenRange }
  | { type: 'clipboardRead' }
  | { type: 'clipboardCopy' }
  | { type: 'findPhone' }
  | { type: 'stopRing' }
  | { type: 'birthday'; name: string | null; within: 'next' | 'week' | 'month' }
  | { type: 'ride'; app: RideApp | null; destination: string | null }
  | { type: 'search'; app: SearchApp; query: string };

export type RideApp = 'uber' | 'bolt' | 'lyft' | 'freenow';
export type SearchApp =
  'youtube' | 'spotify' | 'amazon' | 'playstore' | 'maps' | 'google' | 'web' | 'waze';

const LEAD =
  /^(?:hey |ok |okay )?(?:sidekick,? )?(?:please )?(?:(?:can|could|would|will) you (?:please )?)?/i;
const TAIL = /[\s,]*(?:please|thanks|thank you|for me|now)?[.!?\s]*$/i;

function clean(q: string): string {
  return q.trim().replace(/\s+/g, ' ').replace(LEAD, '').replace(TAIL, '').trim();
}

const SEARCH_APPS: [RegExp, SearchApp][] = [
  [/^you ?tube$/i, 'youtube'],
  [/^spotify$/i, 'spotify'],
  [/^amazon$/i, 'amazon'],
  [/^(the )?(google )?play( store)?$/i, 'playstore'],
  [/^(google )?maps?$|^the map$/i, 'maps'],
  [/^google$/i, 'google'],
  [/^(the )?(web|internet|browser)$|^(chrome|my browser)$/i, 'web'],
  [/^waze$/i, 'waze'],
];

function searchApp(name: string): SearchApp | null {
  const n = name.trim().replace(/\s+app$/i, '');
  for (const [re, app] of SEARCH_APPS) if (re.test(n)) return app;
  return null;
}

const RIDE_APPS: [RegExp, RideApp][] = [
  [/\buber\b/i, 'uber'],
  [/\bbolt\b/i, 'bolt'],
  [/\blyft\b/i, 'lyft'],
  [/\bfree ?now\b/i, 'freenow'],
];

export function parseExtra(question: string): Extra | null {
  const q = clean(question);
  if (!q || q.length > 120) return null;
  let m: RegExpExecArray | null;

  // Find my phone / stop ringing.
  if (
    /^(where('s| is) my phone|find my phone|ring my phone|make (my|the) phone ring|i can'?t find my phone|help me find my phone)$/i.test(
      q,
    )
  )
    return { type: 'findPhone' };
  if (/^(stop|stop (the )?ringing|stop that (noise|sound)|(ok |okay )?(i )?found it)$/i.test(q))
    return { type: 'stopRing' };

  // Battery and storage.
  if (
    /\b(battery|charge level)\b/i.test(q) &&
    /^(what|how|is|am|when|battery|check|tell)\b/i.test(q) &&
    (/\b(my|phone|i|i've)\b/i.test(q) || /^battery\b/i.test(q)) &&
    !/\b(car|camera|headphones?|earbuds?|watch|iphone|laptop)\b/i.test(q)
  )
    return { type: 'battery' };
  if (
    /^(is (my|the) phone charging|how long (until|till|before) (my phone |the phone |it )?(is |'s )?(fully )?(charged|full))$/i.test(
      q,
    )
  )
    return { type: 'battery' };
  if (
    /\b(storage|free space|space (left|free)|disk space)\b/i.test(q) &&
    /^(what|how|is|do|have|check|tell|am)\b/i.test(q) &&
    !/\bsidekick\b/i.test(q)
  )
    return { type: 'storage' };

  // Steps.
  if (/\b(how many steps|step count|steps (have i|did i)|my steps)\b/i.test(q)) {
    return { type: 'steps', day: /\byesterday\b/i.test(q) ? 'yesterday' : 'today' };
  }

  // Screen time.
  const range: ScreenRange = /\byesterday\b/i.test(q)
    ? 'yesterday'
    : /\b(this|past|last) (week|7 days)\b/i.test(q)
      ? 'week'
      : 'today';
  if (/\bscreen ?time\b/i.test(q) && !/\b(set|limit|turn|block)\b/i.test(q)) {
    m =
      /\b(?:on|for|in) ([a-z0-9 .+'-]{2,30}?)(?: (?:today|yesterday|this week|last week))?$/i.exec(
        q,
      );
    const app = m && !/^(my phone|the phone|today|yesterday)$/i.test(m[1]) ? m[1] : null;
    return { type: 'screenTime', app, range };
  }
  if (
    (m =
      /^how (?:long|much time) (?:have i (?:been|spent)|did i (?:spend|use|spent)|was i|am i|i spent|i've spent|have i used) (?:on |using |in |with )?(?:the )?([a-z0-9 .+'-]{2,30}?)(?: app)?(?: (?:today|yesterday|this week|in the last week|over the last week))?$/i.exec(
        q,
      ))
  ) {
    const app = m[1].trim();
    if (/^(my phone|the phone|phone|screen|my screen)$/i.test(app))
      return { type: 'screenTime', app: null, range };
    if (
      !/^(at|with|doing|talking|by|outside|inside|there|here|for|to)\b/i.test(app) &&
      !/\b(walk|run|sleep|work|meeting|call|asleep|awake|out|home|gym|shop|school)\b/i.test(app)
    )
      return { type: 'screenTime', app, range };
  }

  // Clipboard.
  if (
    /^(read|say|tell me|what('s| is)|show)( me)?( out)? (what i('ve| have)? copied|(on |in )?(my|the) clipboard|what('s| is) (on|in) (my|the) clipboard)$/i.test(
      q,
    ) ||
    /^what('s| is) (on|in) (my|the) clipboard$/i.test(q) ||
    /^what did i (just )?copy$/i.test(q)
  )
    return { type: 'clipboardRead' };
  if (
    /^copy (that|this|it|the answer|your answer|what you (just )?said)( to (my|the) clipboard)?$/i.test(
      q,
    ) ||
    /^put (that|it) (on|in) (my|the) clipboard$/i.test(q)
  )
    return { type: 'clipboardCopy' };

  // Birthdays (from contacts).
  if (/\bbirthdays?\b/i.test(q)) {
    if ((m = /^when('s| is) ([a-z][a-z .'-]{1,40}?)(?:'s|s') birthday$/i.exec(q)))
      if (!/^(my|your)$/i.test(m[2]))
        return { type: 'birthday', name: m[2].trim(), within: 'next' };
    if (
      /^(whose|who('s| has| has a)?|any|are there any|is there a) .*birthdays?\b/i.test(q) ||
      /^what (birthdays|birthdays? (are|is) (coming|next|soon))\b/i.test(q) ||
      /\bbirthdays? (coming up|this week|this month|next)\b/i.test(q) ||
      /^(upcoming |next )birthdays?$/i.test(q)
    )
      return {
        type: 'birthday',
        name: null,
        within: /\bthis week\b/i.test(q) ? 'week' : /\bthis month\b/i.test(q) ? 'month' : 'next',
      };
  }

  // Rides: "get me an Uber to the station", "book a taxi to Heathrow", "order a Bolt".
  if (
    /^(get|book|order|call|request|find)( me)? (an? |my )?(uber|bolt|lyft|free ?now|taxi|cab|ride|car)\b/i.test(
      q,
    )
  ) {
    let app: RideApp | null = null;
    for (const [re, a] of RIDE_APPS) if (re.test(q)) app = a;
    m = /\b(?:to|for) ([^,]{2,80}?)(?: (?:with|on|using) (?:uber|bolt|lyft|free ?now))?$/i.exec(q);
    const destination = m && !/^(me|now|us)$/i.test(m[1]) ? m[1].replace(/^the /i, 'the ') : null;
    return { type: 'ride', app, destination };
  }

  // Waze: "navigate to the airport with Waze", "Waze to work".
  if (
    (m =
      /^(?:navigate|directions|drive|take me|get me|go)(?: me)? to (.+?) (?:with|on|in|using|via) waze$/i.exec(
        q,
      )) ||
    (m = /^waze (?:me )?to (.+)$/i.exec(q))
  )
    return { type: 'search', app: 'waze', query: m[1].trim() };

  // Search in an app: "search YouTube for pasta recipes", "find running shoes on Amazon",
  // "look up X on the Play Store", "show me petrol stations on the map".
  if (
    (m =
      /^(?:search|look|check)(?: on| in)? (?:the )?(you ?tube|spotify|amazon|(?:google )?play(?: store)?|google maps|maps|google|the web|the internet|chrome) for (.+)$/i.exec(
        q,
      ))
  ) {
    const app = searchApp(m[1]);
    if (app) return { type: 'search', app, query: m[2].trim() };
  }
  if (
    (m =
      /^(?:search(?: for)?|look up|find|show me|look for) (.+?) (?:on|in|using) (?:the )?(you ?tube|spotify|amazon|(?:google )?play(?: store)?|google maps|maps|map|google|web|internet|chrome|browser)(?: app)?$/i.exec(
        q,
      ))
  ) {
    const app = searchApp(m[2]);
    if (app) return { type: 'search', app, query: m[1].trim() };
  }
  if ((m = /^google (.+)$/i.exec(q)) && !/^(maps|play|tasks|drive|calendar)\b/i.test(m[1]))
    return { type: 'search', app: 'google', query: m[1].trim() };
  return null;
}

// --- Steps ---

export type StepSample = { at: number; count: number };

export type StepsToday = {
  steps: number;
  /** When counting started: midnight, the restart, or the first reading Sidekick has. */
  since: number;
  /** 'midnight' exact; 'restart' all steps since the phone restarted today; 'reading'
   * counted from Sidekick's first reading today; 'before' from yesterday's last reading
   * (includes some of yesterday). */
  from: 'midnight' | 'restart' | 'reading' | 'before';
};

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** iPhone: the period to ask Motion & Fitness for (today so far, or all of yesterday). */
export function stepWindow(day: 'today' | 'yesterday', now: number): { start: Date; end: Date } {
  const midnight = startOfDay(now);
  if (day === 'today') return { start: new Date(midnight), end: new Date(now) };
  return { start: new Date(startOfDay(midnight - 1)), end: new Date(midnight) };
}

/** "1,234 steps today." */
export function stepsSentence(steps: number, day: 'today' | 'yesterday'): string {
  const n = Math.max(0, Math.round(steps));
  return `${n.toLocaleString()} step${n === 1 ? '' : 's'} ${day}.`;
}

const NEAR_MIDNIGHT_MS = 30 * 60_000;

/**
 * Steps today from the phone's step counter (it counts from the last restart, in hardware,
 * with Sidekick closed) and earlier readings. Null when there is nothing to count from yet.
 */
export function stepsToday(
  samples: StepSample[],
  now: StepSample,
  bootAt: number,
): StepsToday | null {
  const midnight = startOfDay(now.at);
  if (bootAt >= midnight) return { steps: Math.round(now.count), since: bootAt, from: 'restart' };
  // Readings from this run of the phone (a restart resets the counter).
  const same = samples
    .filter((s) => s.at >= bootAt - 60_000 && s.at <= now.at && s.count <= now.count)
    .sort((a, b) => a.at - b.at);
  const before = same.filter((s) => s.at < midnight).at(-1);
  if (before && midnight - before.at <= NEAR_MIDNIGHT_MS)
    return { steps: Math.round(now.count - before.count), since: midnight, from: 'midnight' };
  const first = same.find((s) => s.at >= midnight);
  if (first)
    return { steps: Math.round(now.count - first.count), since: first.at, from: 'reading' };
  if (before)
    return { steps: Math.round(now.count - before.count), since: before.at, from: 'before' };
  return null;
}

/** Yesterday's steps: the readings nearest each end of yesterday in the same run of the phone. */
export function stepsYesterday(samples: StepSample[], now: number, bootAt: number): number | null {
  const today = startOfDay(now);
  const yesterday = startOfDay(today - 12 * 3_600_000);
  const same = samples.filter((s) => s.at >= bootAt - 60_000).sort((a, b) => a.at - b.at);
  const start = [...same].reverse().find((s) => s.at <= yesterday + NEAR_MIDNIGHT_MS);
  const end = same.find((s) => s.at >= today - NEAR_MIDNIGHT_MS);
  if (!start || !end || start.at < yesterday - NEAR_MIDNIGHT_MS) return null;
  if (end.at > today + NEAR_MIDNIGHT_MS) return null;
  return Math.max(0, Math.round(end.count - start.count));
}

/** Keeps 3 days of readings, at most one per 10 minutes (the first reading of a day stays). */
export function addSample(samples: StepSample[], s: StepSample): StepSample[] {
  const kept = samples.filter((x) => s.at - x.at < 3 * 86_400_000 && x.at <= s.at);
  const last = kept.at(-1);
  if (last && s.at - last.at < 10 * 60_000 && startOfDay(last.at) === startOfDay(s.at)) {
    const prev = kept.at(-2);
    if (prev && startOfDay(prev.at) === startOfDay(s.at)) kept[kept.length - 1] = s;
    return kept;
  }
  return [...kept, s];
}

// --- Formatting ---

export function clock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function duration(ms: number): string {
  if (ms < 60_000) return 'under a minute';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function gigabytes(bytes: number): string {
  const gb = bytes / 1e9;
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

export function rangeStart(range: ScreenRange, now: number): { from: number; to: number } {
  const today = startOfDay(now);
  if (range === 'yesterday') return { from: startOfDay(today - 12 * 3_600_000), to: today };
  if (range === 'week') return { from: now - 7 * 86_400_000, to: now };
  return { from: today, to: now };
}

export const RANGE_WORDS: Record<ScreenRange, string> = {
  today: 'today',
  yesterday: 'yesterday',
  week: 'in the last 7 days',
};

// --- Birthdays ---

export type Birthday = { name: string; month: number; day: number; year?: number };

/** Days from today until the next birthday (0 = today). */
export function daysUntil(b: Birthday, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), b.month - 1, b.day);
  if (next < today) next = new Date(now.getFullYear() + 1, b.month - 1, b.day);
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function birthdayLine(b: Birthday, now: Date): string {
  const d = daysUntil(b, now);
  const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : `on ${b.day} ${MONTHS[b.month - 1]}`;
  const thisYear = new Date(now.getFullYear(), b.month - 1, b.day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const turns = (thisYear < today ? now.getFullYear() + 1 : now.getFullYear()) - (b.year ?? 0);
  const age = b.year && turns > 0 && turns < 130 ? ` (turning ${turns})` : '';
  return `${b.name}${age} ${when}${d > 1 ? `, in ${d} days` : ''}`;
}

export function upcomingBirthdays(
  list: Birthday[],
  within: 'next' | 'week' | 'month',
  now: Date,
): Birthday[] {
  const sorted = [...list].sort((a, b) => daysUntil(a, now) - daysUntil(b, now));
  if (within === 'week') return sorted.filter((b) => daysUntil(b, now) <= 7);
  if (within === 'month') return sorted.filter((b) => daysUntil(b, now) <= 31);
  const first = sorted[0];
  if (!first) return [];
  const d = daysUntil(first, now);
  return sorted.filter((b) => daysUntil(b, now) === d);
}

// --- Links for other apps (formats from each app's own documentation) ---

/**
 * Where a search goes: the named app when installed, else the browser. With Sidekick Offline
 * (online lookup off, or no internet) a browser search is never opened by itself: the reply
 * offers "Search the web in your browser" and nothing leaves the phone until the user taps it.
 * Apps the user names (YouTube, Maps…) still open, like message hand-offs do offline (ADR 6).
 */
export function searchHandOff(
  app: SearchApp,
  installed: (pkg: string) => boolean,
  online: boolean,
): 'app' | 'browser' | 'tap' {
  const pkg = APP_PACKAGES[app];
  if (pkg && installed(pkg)) return 'app';
  return online ? 'browser' : 'tap';
}

/** The reply when an offline browser search waits for a tap. */
export function offlineSearchLine(app: SearchApp, query: string): string {
  const where = app === 'web' || app === 'google' ? 'the web' : APP_NAMES[app];
  return `Sidekick is offline, so I didn't open your browser. Tap below to search ${where} for ${query}.`;
}

export const APP_PACKAGES: Record<SearchApp | RideApp, string> = {
  youtube: 'com.google.android.youtube',
  spotify: 'com.spotify.music',
  amazon: 'com.amazon.mShop.android.shopping',
  playstore: 'com.android.vending',
  maps: 'com.google.android.apps.maps',
  google: '',
  web: '',
  waze: 'com.waze',
  uber: 'com.ubercab',
  bolt: 'ee.mtakso.client',
  lyft: 'me.lyft.android',
  freenow: 'taxi.android.client',
};

export const APP_NAMES: Record<SearchApp | RideApp, string> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  amazon: 'Amazon',
  playstore: 'the Play Store',
  maps: 'Maps',
  google: 'Google',
  web: 'the web',
  waze: 'Waze',
  uber: 'Uber',
  bolt: 'Bolt',
  lyft: 'Lyft',
  freenow: 'FREENOW',
};

/** Amazon's shop for the phone's region (en-GB → amazon.co.uk); amazon.com otherwise. */
export function amazonHost(locale: string): string {
  const region = /[-_]([A-Z]{2})\b/.exec(locale)?.[1] ?? '';
  const hosts: Record<string, string> = {
    GB: 'amazon.co.uk',
    IE: 'amazon.co.uk',
    DE: 'amazon.de',
    AT: 'amazon.de',
    FR: 'amazon.fr',
    IT: 'amazon.it',
    ES: 'amazon.es',
    NL: 'amazon.nl',
    SE: 'amazon.se',
    PL: 'amazon.pl',
    CA: 'amazon.ca',
    AU: 'amazon.com.au',
    IN: 'amazon.in',
    JP: 'amazon.co.jp',
    MX: 'amazon.com.mx',
    BR: 'amazon.com.br',
  };
  return hosts[region] ?? 'amazon.com';
}

/**
 * The link that opens [app] at a search for [query]. `app` is the link inside the app; `web`
 * is the fallback in the browser when the app isn't installed.
 * Sources: Spotify content linking (spotify: URIs), Google Play "Linking to Google Play"
 * (play.google.com/store/search), Waze deep links (waze.com/ul?q=&navigate=yes), Google Maps
 * intents (geo:0,0?q=), YouTube and Amazon search pages.
 */
export function searchLink(
  app: SearchApp,
  query: string,
  locale = 'en-US',
): { app: string; web: string } {
  const q = encodeURIComponent(query);
  switch (app) {
    case 'youtube': {
      const url = `https://www.youtube.com/results?search_query=${q}`;
      return { app: url, web: url };
    }
    case 'spotify':
      return { app: `spotify:search:${q}`, web: `https://open.spotify.com/search/${q}` };
    case 'amazon': {
      const url = `https://www.${amazonHost(locale)}/s?k=${q}`;
      return { app: url, web: url };
    }
    case 'playstore':
      return {
        app: `https://play.google.com/store/search?q=${q}&c=apps`,
        web: `https://play.google.com/store/search?q=${q}&c=apps`,
      };
    case 'maps':
      return { app: `geo:0,0?q=${q}`, web: `https://www.google.com/maps/search/?api=1&query=${q}` };
    case 'waze': {
      const url = `https://waze.com/ul?q=${q}&navigate=yes`;
      return { app: url, web: url };
    }
    case 'google': {
      const url = `https://www.google.com/search?q=${q}`;
      return { app: url, web: url };
    }
    case 'web': {
      const url = `https://duckduckgo.com/?q=${q}`;
      return { app: url, web: url };
    }
  }
}

/**
 * Uber's documented universal link with the destination set (developer.uber.com, "setPickup");
 * the user picks the car and confirms in Uber. Other ride apps document no destination link,
 * so they open as they are (the destination goes on the clipboard).
 */
export function uberLink(destination: string | null): string {
  const base = 'https://m.uber.com/ul/?action=setPickup&pickup=my_location';
  return destination
    ? `${base}&dropoff[formatted_address]=${encodeURIComponent(destination)}`
    : base;
}

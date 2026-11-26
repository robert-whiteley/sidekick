/**
 * Answers worked out in code, not by the model: sums, unit conversions, the time in another
 * city, and dates (date-answers.ts). Exact and instant (a small model gets arithmetic wrong). Pure; tested in
 * __tests__/quick-answers-test.ts.
 */

import { dateAnswer } from './date-answers';

const LEAD =
  /^(?:hey |ok |okay )?(?:sidekick,? )?(?:please )?(?:(?:can|could) you (?:tell me |work out )?)?(?:what(?:'s| is| are)|whats|calculate|compute|work out|how much is|tell me)?\s*/i;
const TAIL = /[\s,]*(?:please|thanks)?[?.!\s]*$/i;

export function quickAnswer(question: string, now: Date = new Date()): string | null {
  return (
    timeIn(question, now) ??
    dateAnswer(question, now) ??
    convertUnits(question) ??
    calculate(question)
  );
}

// --- Numbers ---

/** At most 6 significant digits, no trailing zeros, thousands separated: 1,234.57. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return groupThousands(String(n));
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e15)) return n.toExponential(4).replace(/\.?0+e/, 'e');
  const digits = Math.max(0, 6 - Math.floor(Math.log10(abs || 1)) - 1);
  const s = n
    .toFixed(Math.min(digits, 8))
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
  return groupThousands(s);
}

function groupThousands(s: string): string {
  const [int, dec] = s.split('.');
  const sign = int.startsWith('-') ? '-' : '';
  const g = int.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${g}${dec ? `.${dec}` : ''}`;
}

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
  thousand: 1000,
  half: 0.5,
  a: 1,
  an: 1,
};

// --- Calculator ---

/** Spoken maths into symbols: "15 percent of 80" → "15%*80", "3 times 4" → "3*4". */
export function toExpression(q: string): string {
  let s = q.toLowerCase().replace(LEAD, '').replace(TAIL, '');
  s = s
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/\bsquare root of\b/g, ' sqrt ')
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:percent|per cent|%)\s*of\b/g, ' $1 % * ')
    .replace(/\b(?:percent|per cent)\b/g, ' % ')
    .replace(/\b(?:to the power of|raised to(?: the power of)?)\b/g, ' ^ ')
    .replace(/\bsquared\b/g, ' ^ 2 ')
    .replace(/\bcubed\b/g, ' ^ 3 ')
    .replace(/\b(?:plus|add|and)\b/g, ' + ')
    .replace(/\b(?:minus|take away|less)\b/g, ' - ')
    .replace(/\b(?:times|multiplied by|x)\b/g, ' * ')
    .replace(/×/g, ' * ')
    .replace(/÷/g, ' / ')
    .replace(/\b(?:divided by|over)\b/g, ' / ')
    .replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand)\b/g,
      (w) => ` ${WORD_NUMBERS[w]} `,
    );
  return s.replace(/\s+/g, ' ').trim();
}

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string };

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  const re = /\s*(\d+(?:\.\d+)?|\.\d+|sqrt|[-+*/^%()])/y;
  let i = 0;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return s.slice(i).trim() ? null : out;
    i = re.lastIndex;
    const v = m[1];
    out.push(/^[\d.]/.test(v) ? { t: 'num', v: parseFloat(v) } : { t: 'op', v });
  }
  return out;
}

/** Recursive descent: + - over * / over ^ over unary, sqrt, %, brackets. */
function evaluate(toks: Tok[]): number | null {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expr = (): number => {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = (): number => {
    let v = power();
    while (isOp('*') || isOp('/')) {
      const op = toks[p++].v;
      const r = power();
      if (op === '/' && r === 0) throw new Error('divide by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const power = (): number => {
    const b = unary();
    if (isOp('^')) {
      p++;
      return Math.pow(b, power());
    }
    return b;
  };
  const unary = (): number => {
    if (isOp('-') || isOp('+')) {
      const neg = toks[p++].v === '-';
      const v = unary();
      return neg ? -v : v;
    }
    if (isOp('sqrt')) {
      p++;
      const v = unary();
      if (v < 0) throw new Error('negative root');
      return Math.sqrt(v);
    }
    let v: number;
    if (isOp('(')) {
      p++;
      v = expr();
      if (!isOp(')')) throw new Error('bracket');
      p++;
    } else {
      const t = toks[p++];
      if (!t || t.t !== 'num') throw new Error('number expected');
      v = t.v;
    }
    while (isOp('%')) {
      p++;
      v /= 100;
    }
    return v;
  };
  try {
    const v = expr();
    return p === toks.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** "What's 12 times 7", "15% of 80", "sqrt 2": the number, or null when it isn't a sum. */
export function calculate(question: string): string | null {
  const e = toExpression(question);
  if (!/\d/.test(e) || !/[-+*/^%]|sqrt/.test(e.replace(/^-/, ''))) return null;
  const toks = tokenize(e);
  if (!toks || toks.length < 2) return null;
  const v = evaluate(toks);
  return v === null ? null : formatNumber(v);
}

// --- Units ---

type Unit = { dim: string; factor: number; name: string; plural?: string };

const U = (dim: string, factor: number, name: string, plural?: string): Unit => ({
  dim,
  factor,
  name,
  plural,
});

/** Base units: metre, kilogram, litre, metre/second, square metre, byte, second. */
const UNITS: Record<string, Unit> = {};
const add = (names: string[], u: Unit) => names.forEach((n) => (UNITS[n] = u));
add(
  ['mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters'],
  U('len', 0.001, 'millimetre'),
);
add(['cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters'], U('len', 0.01, 'centimetre'));
add(['m', 'metre', 'metres', 'meter', 'meters'], U('len', 1, 'metre'));
add(['km', 'kilometre', 'kilometres', 'kilometer', 'kilometers', 'k'], U('len', 1000, 'kilometre'));
add(['in', 'inch', 'inches', '"'], U('len', 0.0254, 'inch', 'inches'));
add(['ft', 'foot', 'feet', "'"], U('len', 0.3048, 'foot', 'feet'));
add(['yd', 'yard', 'yards'], U('len', 0.9144, 'yard'));
add(['mi', 'mile', 'miles'], U('len', 1609.344, 'mile'));
add(['nautical mile', 'nautical miles'], U('len', 1852, 'nautical mile'));
add(['mg', 'milligram', 'milligrams'], U('mass', 1e-6, 'milligram'));
add(['g', 'gram', 'grams', 'gramme', 'grammes'], U('mass', 0.001, 'gram'));
add(['kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme'], U('mass', 1, 'kilogram'));
add(['t', 'tonne', 'tonnes', 'metric ton'], U('mass', 1000, 'tonne'));
add(['oz', 'ounce', 'ounces'], U('mass', 0.028349523125, 'ounce'));
add(['lb', 'lbs', 'pound', 'pounds'], U('mass', 0.45359237, 'pound'));
add(['st', 'stone', 'stones'], U('mass', 6.35029318, 'stone', 'stone'));
add(
  ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'],
  U('vol', 0.001, 'millilitre'),
);
add(['cl', 'centilitre', 'centilitres'], U('vol', 0.01, 'centilitre'));
add(['l', 'litre', 'litres', 'liter', 'liters'], U('vol', 1, 'litre'));
add(['tsp', 'teaspoon', 'teaspoons'], U('vol', 0.00492892, 'teaspoon'));
add(['tbsp', 'tablespoon', 'tablespoons'], U('vol', 0.0147868, 'tablespoon'));
add(['cup', 'cups'], U('vol', 0.24, 'cup'));
add(['fl oz', 'fluid ounce', 'fluid ounces'], U('vol', 0.0295735, 'US fluid ounce'));
add(['pint', 'pints'], U('vol', 0.56826125, 'pint (UK)', 'pints (UK)'));
add(['us pint', 'us pints'], U('vol', 0.473176473, 'US pint'));
add(['gallon', 'gallons'], U('vol', 4.54609, 'gallon (UK)', 'gallons (UK)'));
add(['us gallon', 'us gallons'], U('vol', 3.785411784, 'US gallon'));
add(['mph', 'miles per hour', 'mile per hour'], U('speed', 0.44704, 'mph', 'mph'));
add(
  ['kph', 'km/h', 'kmh', 'kilometres per hour', 'kilometers per hour'],
  U('speed', 1 / 3.6, 'km/h', 'km/h'),
);
add(['m/s', 'metres per second', 'meters per second'], U('speed', 1, 'm/s', 'm/s'));
add(['knot', 'knots'], U('speed', 0.514444, 'knot'));
add(['acre', 'acres'], U('area', 4046.8564224, 'acre'));
add(['hectare', 'hectares', 'ha'], U('area', 10000, 'hectare'));
add(
  ['square metre', 'square metres', 'square meter', 'square meters', 'sq m', 'm2'],
  U('area', 1, 'square metre'),
);
add(
  ['square foot', 'square feet', 'sq ft', 'ft2'],
  U('area', 0.09290304, 'square foot', 'square feet'),
);
add(['kb', 'kilobyte', 'kilobytes'], U('data', 1e3, 'kilobyte'));
add(['mb', 'megabyte', 'megabytes'], U('data', 1e6, 'megabyte'));
add(['gb', 'gigabyte', 'gigabytes'], U('data', 1e9, 'gigabyte'));
add(['tb', 'terabyte', 'terabytes'], U('data', 1e12, 'terabyte'));
add(['second', 'seconds', 'sec', 'secs'], U('time', 1, 'second'));
add(['minute', 'minutes', 'min', 'mins'], U('time', 60, 'minute'));
add(['hour', 'hours', 'hr', 'hrs'], U('time', 3600, 'hour'));
add(['day', 'days'], U('time', 86400, 'day'));
add(['week', 'weeks'], U('time', 604800, 'week'));
add(['year', 'years'], U('time', 31557600, 'year'));

const TEMPS: Record<string, 'c' | 'f' | 'k'> = {
  c: 'c',
  '°c': 'c',
  celsius: 'c',
  centigrade: 'c',
  'degrees c': 'c',
  'degrees celsius': 'c',
  f: 'f',
  '°f': 'f',
  fahrenheit: 'f',
  'degrees f': 'f',
  'degrees fahrenheit': 'f',
  kelvin: 'k',
  'degrees kelvin': 'k',
};
const TEMP_NAME = { c: '°C', f: '°F', k: 'K' };

function toCelsius(v: number, u: 'c' | 'f' | 'k') {
  return u === 'c' ? v : u === 'f' ? ((v - 32) * 5) / 9 : v - 273.15;
}
function fromCelsius(v: number, u: 'c' | 'f' | 'k') {
  return u === 'c' ? v : u === 'f' ? (v * 9) / 5 + 32 : v + 273.15;
}

const unitName = (u: Unit, n: number) =>
  Math.abs(n) === 1 ? u.name : (u.plural ?? (u.name.includes('(') ? u.name : `${u.name}s`));

function parseAmount(s: string): number | null {
  const t = s.trim().replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (t in WORD_NUMBERS) return WORD_NUMBERS[t];
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  return frac && +frac[2] ? +frac[1] / +frac[2] : null;
}

/** "Convert 5 miles to km", "how many grams in a pound", "100 f in c". */
export function convertUnits(question: string): string | null {
  const q = question
    .toLowerCase()
    .replace(LEAD, '')
    .replace(TAIL, '')
    .replace(/^(?:convert|change|turn)\s+/, '')
    .trim();
  let amount: number | null;
  let from: string;
  let to: string;
  const howMany = /^how many (.+?) (?:are )?(?:in|to|per) (?:an? |one )?(?:(\S+) )??(.+)$/.exec(q);
  let m: RegExpExecArray | null;
  if (howMany) {
    to = howMany[1];
    amount = howMany[2] ? parseAmount(howMany[2]) : 1;
    from = howMany[3];
    if (amount === null) {
      from = `${howMany[2]} ${howMany[3]}`;
      amount = 1;
    }
  } else if ((m = /^(-?[\d.,/]+|[a-z]+)\s*(.+?) (?:in|to|into|as) (.+)$/.exec(q))) {
    amount = parseAmount(m[1]);
    from = m[2];
    to = m[3];
  } else return null;
  if (amount === null) return null;
  const f = from.trim();
  const t = to.trim().replace(/^(?:degrees? )/, 'degrees ');
  const tf = TEMPS[f] ?? TEMPS[f.replace(/^degrees? /, '')];
  const tt = TEMPS[t] ?? TEMPS[t.replace(/^degrees? /, '')];
  if (tf && tt) {
    const v = fromCelsius(toCelsius(amount, tf), tt);
    return `${formatNumber(amount)}${TEMP_NAME[tf]} is ${formatNumber(Math.round(v * 10) / 10)}${TEMP_NAME[tt]}.`;
  }
  const uf = UNITS[f];
  const ut = UNITS[t];
  if (!uf || !ut || uf.dim !== ut.dim) return null;
  const v = (amount * uf.factor) / ut.factor;
  return `${formatNumber(amount)} ${unitName(uf, amount)} is ${formatNumber(v)} ${unitName(ut, v)}.`;
}

// --- Time zones ---

/** City or country (as said) → IANA time zone. The big cities people ask about. */
export const ZONES: Record<string, string> = {
  london: 'Europe/London',
  uk: 'Europe/London',
  england: 'Europe/London',
  scotland: 'Europe/London',
  edinburgh: 'Europe/London',
  manchester: 'Europe/London',
  dublin: 'Europe/Dublin',
  ireland: 'Europe/Dublin',
  lisbon: 'Europe/Lisbon',
  portugal: 'Europe/Lisbon',
  paris: 'Europe/Paris',
  france: 'Europe/Paris',
  madrid: 'Europe/Madrid',
  spain: 'Europe/Madrid',
  barcelona: 'Europe/Madrid',
  berlin: 'Europe/Berlin',
  germany: 'Europe/Berlin',
  munich: 'Europe/Berlin',
  amsterdam: 'Europe/Amsterdam',
  netherlands: 'Europe/Amsterdam',
  brussels: 'Europe/Brussels',
  rome: 'Europe/Rome',
  italy: 'Europe/Rome',
  milan: 'Europe/Rome',
  zurich: 'Europe/Zurich',
  switzerland: 'Europe/Zurich',
  vienna: 'Europe/Vienna',
  prague: 'Europe/Prague',
  warsaw: 'Europe/Warsaw',
  poland: 'Europe/Warsaw',
  stockholm: 'Europe/Stockholm',
  oslo: 'Europe/Oslo',
  copenhagen: 'Europe/Copenhagen',
  helsinki: 'Europe/Helsinki',
  athens: 'Europe/Athens',
  greece: 'Europe/Athens',
  istanbul: 'Europe/Istanbul',
  turkey: 'Europe/Istanbul',
  kyiv: 'Europe/Kyiv',
  kiev: 'Europe/Kyiv',
  moscow: 'Europe/Moscow',
  cairo: 'Africa/Cairo',
  egypt: 'Africa/Cairo',
  lagos: 'Africa/Lagos',
  nigeria: 'Africa/Lagos',
  nairobi: 'Africa/Nairobi',
  kenya: 'Africa/Nairobi',
  johannesburg: 'Africa/Johannesburg',
  'cape town': 'Africa/Johannesburg',
  'south africa': 'Africa/Johannesburg',
  dubai: 'Asia/Dubai',
  'abu dhabi': 'Asia/Dubai',
  riyadh: 'Asia/Riyadh',
  'tel aviv': 'Asia/Jerusalem',
  jerusalem: 'Asia/Jerusalem',
  israel: 'Asia/Jerusalem',
  tehran: 'Asia/Tehran',
  karachi: 'Asia/Karachi',
  pakistan: 'Asia/Karachi',
  delhi: 'Asia/Kolkata',
  'new delhi': 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  india: 'Asia/Kolkata',
  dhaka: 'Asia/Dhaka',
  bangkok: 'Asia/Bangkok',
  thailand: 'Asia/Bangkok',
  jakarta: 'Asia/Jakarta',
  bali: 'Asia/Makassar',
  singapore: 'Asia/Singapore',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  manila: 'Asia/Manila',
  'hong kong': 'Asia/Hong_Kong',
  beijing: 'Asia/Shanghai',
  shanghai: 'Asia/Shanghai',
  china: 'Asia/Shanghai',
  taipei: 'Asia/Taipei',
  seoul: 'Asia/Seoul',
  korea: 'Asia/Seoul',
  tokyo: 'Asia/Tokyo',
  japan: 'Asia/Tokyo',
  osaka: 'Asia/Tokyo',
  perth: 'Australia/Perth',
  adelaide: 'Australia/Adelaide',
  brisbane: 'Australia/Brisbane',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  canberra: 'Australia/Sydney',
  auckland: 'Pacific/Auckland',
  'new zealand': 'Pacific/Auckland',
  wellington: 'Pacific/Auckland',
  honolulu: 'Pacific/Honolulu',
  hawaii: 'Pacific/Honolulu',
  anchorage: 'America/Anchorage',
  alaska: 'America/Anchorage',
  'los angeles': 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  vancouver: 'America/Vancouver',
  california: 'America/Los_Angeles',
  denver: 'America/Denver',
  phoenix: 'America/Phoenix',
  chicago: 'America/Chicago',
  dallas: 'America/Chicago',
  houston: 'America/Chicago',
  'mexico city': 'America/Mexico_City',
  mexico: 'America/Mexico_City',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  boston: 'America/New_York',
  washington: 'America/New_York',
  miami: 'America/New_York',
  atlanta: 'America/New_York',
  toronto: 'America/Toronto',
  montreal: 'America/Toronto',
  halifax: 'America/Halifax',
  bogota: 'America/Bogota',
  lima: 'America/Lima',
  santiago: 'America/Santiago',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  argentina: 'America/Argentina/Buenos_Aires',
  'sao paulo': 'America/Sao_Paulo',
  'são paulo': 'America/Sao_Paulo',
  rio: 'America/Sao_Paulo',
  'rio de janeiro': 'America/Sao_Paulo',
  brazil: 'America/Sao_Paulo',
  reykjavik: 'Atlantic/Reykjavik',
  iceland: 'Atlantic/Reykjavik',
};

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Minutes the zone is ahead of UTC at `now` (from Intl; no tz database of our own). */
export function zoneOffsetMinutes(zone: string, now: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
    );
    return Math.round((asUtc - Math.floor(now.getTime() / 60000) * 60000) / 60000);
  } catch {
    return null;
  }
}

/** "What time is it in Tokyo", "time in New York": the local time there, and the difference. */
export function timeIn(question: string, now: Date): string | null {
  const m =
    /\b(?:what(?:'s| is) the )?time(?: is it)? (?:now |right now )?in ([a-z .'ãé-]+?)(?: now| right now)?[?.!\s]*$/i.exec(
      question,
    ) ?? /^what time is it (?:now )?in ([a-z .'ãé-]+?)[?.!\s]*$/i.exec(question);
  if (!m) return null;
  const place = m[1].trim().toLowerCase().replace(/^the /, '');
  const zone = ZONES[place];
  if (!zone) return null;
  const there = zoneOffsetMinutes(zone, now);
  if (there === null) return null;
  const here = -now.getTimezoneOffset();
  const shifted = new Date(now.getTime() + there * 60000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const localDay = new Date(now.getTime() + here * 60000).getUTCDay();
  const day = shifted.getUTCDay() !== localDay ? ` on ${days[shifted.getUTCDay()]}` : '';
  const diff = (there - here) / 60;
  const ahead =
    diff === 0
      ? 'the same as here'
      : `${formatNumber(Math.abs(diff))} hour${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'ahead of' : 'behind'} you`;
  return `It's ${hh}:${mm}${day} in ${title(place)}, ${ahead}.`;
}

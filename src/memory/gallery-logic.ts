/**
 * Phone search (photos and files the user allowed): the decisions that don't touch the phone.
 * Pure; tested in __tests__/gallery-logic-test.ts. The I/O is in gallery.ts and
 * engine/phone-search.ts.
 */
import { hash, planSync, type Existing } from './sources-logic';

/** gallery.state: waiting to be read / text and place read / photo vector made / can't be read. */
export const G_NEW = 0;
export const G_READ = 1;
export const G_DONE = 2;
export const G_FAILED = 9;

export const GALLERY_LIMITS = {
  /** Newest photos kept in the index (about 1.3 KB each: vector, read text, date, place). */
  maxPhotos: 20_000,
  /** The library is listed again this often while the app is open (and when it says it changed). */
  scanEveryMs: 30 * 60_000,
  /** Photos read per idle tick (text, ~1-1.5 s each on a Pixel 5) and given a vector (~6.5 s). */
  readPerTick: 8,
  vectorsPerTick: 3,
  /** The copy read for text: the same size the camera photos are read at (Ocr.kt). */
  readEdge: 2048,
  /** The copy shown in the chat when a photo is found. */
  showEdge: 1280,
  /** Listing page size (metadata only, no files opened). */
  page: 500,
};

/** Rough index size per photo, for Settings (vector 1 KB + text, date, place, word index). */
export const BYTES_PER_PHOTO = 1300;

export type LibraryAsset = {
  id: string;
  filename: string | null;
  creationTime: number | null;
  modificationTime: number | null;
};

/** What a gallery row is made from: a library photo or an image file in a picked folder. */
export type GalleryItem = { key: string; ver: string; at: number; name: string; origin: string };

/** Picked-folder images and Photos-library items share the table; origin says which. */
export const LIBRARY = 'library';
export const folderOrigin = (folderUri: string) => `folder:${folderUri}`;

export function libraryItem(a: LibraryAsset): GalleryItem {
  const at = a.creationTime ?? a.modificationTime ?? 0;
  return {
    key: a.id,
    ver: String(a.modificationTime ?? a.creationTime ?? 0),
    at,
    name: a.filename ?? '',
    origin: LIBRARY,
  };
}

/** Image files a picked folder adds to phone search (JPEG, PNG, WebP, HEIC). */
export function isImageFile(name: string): boolean {
  return !name.startsWith('.') && /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
}

/**
 * What to change so the stored photos of one origin match [incoming]: new ones added, changed ones
 * read again, gone ones (deleted on the phone, or no longer allowed) removed. Only the newest
 * [max] are kept.
 */
export function planGallery(
  existing: Existing[],
  incoming: GalleryItem[],
  max = GALLERY_LIMITS.maxPhotos,
) {
  const newest = [...incoming].sort((a, b) => b.at - a.at).slice(0, max);
  const byKey = new Map(newest.map((i) => [i.key, i]));
  const plan = planSync(
    existing,
    newest.map((i) => ({ key: i.key, ver: i.ver, at: i.at, text: '' })),
  );
  return {
    insert: plan.insert.map((i) => byKey.get(i.key)!),
    update: plan.update.map((u) => ({ ...byKey.get(u.key)!, id: u.id })),
    remove: plan.remove,
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "Thu 3 Dec 2026, 10:05" in local time. */
export function dateLabel(at: number): string {
  const d = new Date(at);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A photo looks like a screenshot by its file name (the phone names them so). */
export const isScreenshotName = (name: string) => /screenshot|screen_shot|screen shot/i.test(name);

/**
 * Searchable words in a file name, at once when a photo is listed (before it is read):
 * "Screenshot_20261127-100512_Chrome.jpg" → "Screenshot Chrome". Numbers and the extension are
 * dropped (the date is kept as a date).
 */
export function nameWords(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .split(/[\s_\-.()[\]]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !/^(img|dsc|pxl|mvimg|image)$/i.test(w))
    .join(' ');
}

/** The words stored for a photo (word search and the prompt): its name, and the text read. */
export function photoIndexText(name: string, read: string | null): string {
  const words = nameWords(name);
  const shot = isScreenshotName(name) && !/screenshot/i.test(words) ? 'Screenshot' : '';
  return [shot, words, read ?? ''].filter(Boolean).join('. ');
}

// --- How much slow photo work may run now ---

/**
 * The expensive tier (text reading ~1-3 s and a photo vector ~6.5 s per photo on a Pixel 5):
 * full speed on a charger that keeps up; on battery a small share of wall time that shrinks with
 * the battery level and stops when the phone is warm, in battery saver or under the floor.
 */
export const PHOTO_BUDGET = {
  /** Share of time on a full battery (2% ≈ 0.05 W at 2.5 W while working: ~0.3% battery/h). */
  maxDuty: 0.02,
  /** No slow work on battery below this level (the default; Settings → Phone search). */
  floor: 0.3,
  /** Saved-up time cap on battery, so a long idle spell doesn't become a long burst. */
  capMs: 20_000,
  /** First guesses until the phone has measured itself (ms per photo). */
  readMs: 2_000,
  vectorMs: 7_000,
  /** Search time: unread recent photos are read for at most this long. */
  onDemandMs: 4_000,
  /** ...newest first, at most this many. */
  onDemandMax: 6,
  /** "Recent" for search-time reading and for showing photos that aren't fully read yet. */
  recentMs: 24 * 3_600_000,
};

/** The share of wall time slow photo work may use now: 1 = as fast as it goes, 0 = none. */
export function photoDuty(s: {
  charging: boolean;
  batteryLevel: number;
  lowPowerMode: boolean;
  /** Android PowerManager.THERMAL_STATUS_* (1 = light, 2 = moderate). */
  thermalStatus: number;
  drainingOnCharger?: boolean;
  /** Settings → Phone search: read on battery at all, and the lowest level (0-1). */
  onBattery?: boolean;
  floor?: number;
}): number {
  if (s.thermalStatus >= 2) return 0;
  if (s.charging) return s.drainingOnCharger ? 0 : 1;
  const floor = Math.min(1, Math.max(0, s.floor ?? PHOTO_BUDGET.floor));
  if (s.onBattery === false || s.lowPowerMode || s.thermalStatus >= 1) return 0;
  if (s.batteryLevel < floor || floor >= 1) return 0;
  const f = (Math.min(1, s.batteryLevel) - floor) / (1 - floor);
  return PHOTO_BUDGET.maxDuty * f;
}

/** Time saved up for slow work: [duty] of the time since [lastAt], capped. */
export function refillBudget(tokensMs: number, lastAt: number, now: number, duty: number): number {
  const dt = Math.max(0, now - lastAt);
  return Math.min(PHOTO_BUDGET.capMs, tokensMs + dt * duty);
}

/** The measured cost per photo, smoothed (the phone's own speed, heat and model state). */
export function updateCost(prev: number | null, measuredMs: number): number {
  if (prev == null || !Number.isFinite(prev)) return measuredMs;
  return Math.round(prev * 0.7 + measuredMs * 0.3);
}

// --- Search results ---

export type Found = {
  kind: 'photo' | 'file';
  /** What opens or re-reads it: the library id or the file's URI. */
  ref: string;
  title: string;
  at: number;
  place?: string | null;
  /** The best-matching words (a photo's read text, the file passage that matched). */
  excerpt: string;
  /** Files: the key prefix of its passages (to read the whole file). */
  fileKey?: string;
};

/** Up to [n] results, newest first when the newest one is wanted, else best match first. */
export function orderFound(found: Found[], newest: boolean, n = 8): Found[] {
  const top = found.slice(0, n);
  return newest ? [...top].sort((a, b) => b.at - a.at) : top;
}

/** Results within [from, to) when a time is meant. */
export function inRange(found: Found[], from?: number, to?: number): Found[] {
  return found.filter((f) => (from == null || f.at >= from) && (to == null || f.at < to));
}

/** "File Documents/Bills/acme-nov.pdf (part 2):\n…" → the path and the passage. */
export function splitFileText(text: string): { path: string; body: string } {
  const m = /^File (.+?)(?: \(part \d+\))?:\n([\s\S]*)$/.exec(text);
  return m ? { path: m[1], body: m[2] } : { path: '', body: text };
}

/** Every passage key of one file: "file:<folder>|<file uri>#" (sources-logic fileKeyPrefix). */
export function fileKeyOf(sourceKey: string): string | null {
  const i = sourceKey.lastIndexOf('#');
  return sourceKey.startsWith('file:') && i > 0 ? sourceKey.slice(0, i + 1) : null;
}

/** The file's URI from its passage key. */
export function fileUriOf(fileKey: string): string {
  const bar = fileKey.indexOf('|');
  return fileKey.slice(bar + 1, fileKey.endsWith('#') ? -1 : undefined);
}

/**
 * The whole file's text for the answer, in passage order. A long one keeps its start and its end
 * (an invoice's total is usually near the end).
 */
export function fileBody(passages: { n: number; text: string }[], max = 8000): string {
  const text = [...passages]
    .sort((a, b) => a.n - b.n)
    .map((p) => splitFileText(p.text).body)
    .join('\n\n');
  if (text.length <= max) return text;
  const tail = Math.floor(max / 4);
  return `${text.slice(0, max - tail)}\n…\n${text.slice(-tail)}`;
}

const clip = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, '')}…`;

/** One line per result for the model's pick, numbered from 1. */
export function foundList(found: Found[], excerptChars = 280): string {
  return found
    .map((f, i) => {
      const where = f.place ? ` in ${f.place}` : '';
      const what = f.kind === 'photo' ? `Photo ${f.title}`.trim() : `File ${f.title}`;
      const text = f.excerpt.replace(/\s+/g, ' ').trim();
      return `[${i + 1}] ${what}, ${dateLabel(f.at)}${where}: ${text ? clip(text, excerptChars) : '(no text)'}`;
    })
    .join('\n');
}

export const PICK_SYSTEM = 'You find things on a phone. Reply with one number only.';

/** The model picks which result the request means (0 = none of them). */
export function pickPrompt(request: string, found: Found[], newest: boolean): string {
  return `Request: ${JSON.stringify(request)}
Found on the phone${newest ? ', newest first' : ''}:
${foundList(found)}

Which one does the request mean${newest ? ' (the newest that fits)' : ''}? Reply with its number, or 0 if none fits.`;
}

/** The model's pick → an index into the list, or -1. */
export function parsePick(reply: string, count: number): number {
  const m = /\d+/.exec(reply);
  if (!m) return -1;
  const n = Number(m[0]);
  return n >= 1 && n <= count ? n - 1 : -1;
}

/**
 * Money amounts written in a text ("£21.60", "21,60 EUR", "$1,200"), in order, each once. Exact
 * figures the model copies instead of re-reading them.
 */
export function amountsIn(text: string, max = 12): string[] {
  const cur = '[£$€¥₹]|(?:GBP|USD|EUR|CHF|AUD|CAD|JPY|INR|SEK|NOK|DKK|PLN)\\b';
  const num = '\\d{1,3}(?:[,. ]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
  const re = new RegExp(`(?:(?:${cur})\\s?(?:${num}))|(?:(?:${num})\\s?(?:${cur}))`, 'g');
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const a = m[0].trim();
    if (!out.includes(a)) out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

/** The answer prompt: the request and the one found photo or file. */
export function answerPrompt(request: string, f: Found, body: string): string {
  const where = f.place ? `, in ${f.place}` : '';
  const head =
    f.kind === 'photo'
      ? `A photo on the phone, taken ${dateLabel(f.at)}${where}.`
      : `The file ${f.title} on the phone, saved ${dateLabel(f.at)}.`;
  const amounts = amountsIn(body);
  const text = body.trim()
    ? `\n${f.kind === 'photo' ? 'Text read from the photo' : 'Its text'}:\n${body.trim()}`
    : '';
  return `${head}${text}${amounts.length ? `\nAmounts written in it: ${amounts.join(', ')}` : ''}

Request: ${JSON.stringify(request)}
Answer in one or two short sentences: say which ${f.kind} it is (its date) and what the request asks, using exact figures from it. If it doesn't say, say so.`;
}

/** A stable file name for the copy of a found photo shown in the chat. */
export const shownName = (ref: string) => `found-${hash(ref)}.jpg`;

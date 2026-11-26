/**
 * "Your data sources" (notes, folders, calendar, contacts, notifications): the decisions that
 * don't touch the phone. Pure functions; tested.
 */

/** Moment kinds made by data sources; "delete by source" deletes one kind. */
export const SOURCE_KINDS = ['note', 'file', 'event', 'notification'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_LABEL: Record<SourceKind, string> = {
  note: 'note',
  file: 'file',
  event: 'calendar',
  notification: 'notification',
};

// --- Syncing ---

export type SourceItem = { key: string; ver: string; at: number; text: string };
export type Existing = { id: number; key: string; ver: string | null };

/**
 * What to change so the stored items under one source match [incoming]: new keys are inserted,
 * changed versions updated in place (so the moment id stays), missing keys removed.
 */
export function planSync(existing: Existing[], incoming: SourceItem[]) {
  const have = new Map(existing.map((e) => [e.key, e]));
  const seen = new Set<string>();
  const insert: SourceItem[] = [];
  const update: (SourceItem & { id: number })[] = [];
  for (const item of incoming) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const old = have.get(item.key);
    if (!old) insert.push(item);
    else if (old.ver !== item.ver) update.push({ ...item, id: old.id });
  }
  const remove = existing.filter((e) => !seen.has(e.key)).map((e) => e.id);
  return { insert, update, remove };
}

/** How often each source is re-read while the app is open. */
export const SYNC_EVERY_MS = {
  folders: 15 * 60_000,
  calendar: 6 * 3600_000,
  contacts: 24 * 3600_000,
} as const;
export type SyncedSource = keyof typeof SYNC_EVERY_MS;

export function isDue(source: SyncedSource, lastRun: number | null, now: number): boolean {
  return lastRun == null || now - lastRun >= SYNC_EVERY_MS[source] || lastRun > now;
}

/** Items older than the retention setting are not imported (retention would delete them). */
export function retentionCutoff(retentionDays: number, now: number): number {
  return retentionDays > 0 ? now - retentionDays * 86_400_000 : -Infinity;
}

/** Small stable hash (djb2) for version strings and dedupe keys. */
export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// --- Folders ---

export const FILE_LIMITS = {
  maxFiles: 2000,
  maxDepth: 4,
  maxBytes: 1_000_000,
  chunkChars: 1200,
  maxChunks: 50,
};

/** Plain-text files, and PDFs where the phone can read them ([pdf]: Android only). */
export function isIndexableFile(name: string, size: number | null, pdf = false): boolean {
  return indexableKind(name, size, pdf) != null;
}

/** "text" / "pdf" for files a folder source reads, null for everything else. */
export function indexableKind(
  name: string,
  size: number | null,
  pdf = false,
): 'text' | 'pdf' | null {
  if (name.startsWith('.')) return null;
  if (pdf && /\.pdf$/i.test(name)) {
    return size != null && size > PDF_LIMITS.maxBytes ? null : 'pdf';
  }
  if (size != null && size > FILE_LIMITS.maxBytes) return null;
  return /\.(txt|md|markdown|text)$/i.test(name) ? 'text' : null;
}

// --- PDFs ---

export const PDF_LIMITS = {
  /** Pages read per PDF (the first ones). */
  maxPages: 30,
  maxBytes: 50_000_000,
  /** 30 pages of ~3,000 characters would overflow the text-file cap of 50 passages. */
  maxChunks: 100,
  /** No new PDF is started once a folder scan has OCR'd this many pages; the rest wait for the next scan. */
  ocrPagesPerScan: 60,
  /** A page with fewer letters/digits than this in its embedded text is treated as a scan. */
  minTextChars: 20,
};

/** Pages to read from a PDF of [pageCount] pages. */
export const pdfPagesToRead = (pageCount: number) =>
  Math.max(0, Math.min(pageCount, PDF_LIMITS.maxPages));

/** Embedded page text with too little in it (a scan, or only a page number) is OCR'd instead. */
export function pageNeedsOcr(embedded: string | null): boolean {
  return (embedded?.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < PDF_LIMITS.minTextChars;
}

/** Tidies one page's text: no trailing spaces or runs of blank lines. */
export function cleanPageText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A whole PDF's text: its pages, in order, separated by blank lines (so chunks break there). */
export function pdfText(pages: (string | null)[]): string {
  return pages
    .map((p) => cleanPageText(p ?? ''))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The version stored for a PDF's passages. Read without OCR (models not downloaded yet), it
 * differs, so the PDF is read again once OCR is there.
 */
export const pdfVer = (modified: number, complete: boolean) =>
  complete ? String(modified) : `${modified}:no-ocr`;

/** A stored PDF need not be read again: same file, and not waiting for OCR that is now there. */
export function pdfUnchanged(storedVers: (string | null)[], modified: number, ocrReady: boolean) {
  if (!storedVers.length) return false;
  return storedVers.every(
    (v) => v === pdfVer(modified, true) || (!ocrReady && v === pdfVer(modified, false)),
  );
}

/**
 * Splits text into pieces of at most [max] characters, breaking at blank lines, then lines,
 * then sentences, then words. Each piece is embedded and found on its own.
 */
export function chunkText(
  text: string,
  max = FILE_LIMITS.chunkChars,
  maxChunks = FILE_LIMITS.maxChunks,
): string[] {
  const out: string[] = [];
  let cur = '';
  const push = () => {
    const t = cur.trim();
    if (t) out.push(t);
    cur = '';
  };
  const pieces = text.replace(/\r\n?/g, '\n').split(/(\n\s*\n)/);
  for (const piece of pieces) {
    if (cur.length + piece.length <= max) {
      cur += piece;
      continue;
    }
    push();
    if (piece.length <= max) {
      cur = piece;
      continue;
    }
    // One long paragraph: split by sentence/word.
    for (const word of piece.split(/(?<=[.!?\n])\s+|\s+/)) {
      if (cur.length + word.length + 1 > max) push();
      if (word.length > max) {
        for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
        continue;
      }
      cur += (cur ? ' ' : '') + word;
    }
  }
  push();
  return out.slice(0, maxChunks);
}

/** Every key of one picked folder starts with this. */
export const folderKeyPrefix = (folderUri: string) => `file:${folderUri}|`;
/** Every chunk key of one file starts with this (then the chunk number). */
export const fileKeyPrefix = (folderUri: string, fileUri: string) =>
  `${folderKeyPrefix(folderUri)}${fileUri}#`;

/** Moments for one text file (or PDF): one per chunk, keyed by file and chunk number. */
export function fileItems(
  folderUri: string,
  fileUri: string,
  path: string,
  modified: number,
  text: string,
  ver = String(modified),
  maxChunks = FILE_LIMITS.maxChunks,
): SourceItem[] {
  return chunkText(text, FILE_LIMITS.chunkChars, maxChunks).map((chunk, i) => ({
    key: `${fileKeyPrefix(folderUri, fileUri)}${i}`,
    ver,
    at: modified,
    text: `File ${path}${i ? ` (part ${i + 1})` : ''}:\n${chunk}`,
  }));
}

// --- Calendar ---

export type CalEvent = {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string | null;
  notes: string | null;
};

/** The calendar window read: a year back, a year ahead. */
export const CALENDAR_PAST_MS = 365 * 86_400_000;
export const CALENDAR_AHEAD_MS = 365 * 86_400_000;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "Thu 3 Dec 2026, 10:00" in local time (fixed English: it is matched by search words). */
function fmtDate(at: number, withTime: boolean): string {
  const d = new Date(at);
  const date = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return withTime ? `${date}, ${hhmm(d)}` : date;
}

/** All-day events are stored at UTC midnight (Android): read the date in UTC. */
function fmtUtcDate(at: number): string {
  const d = new Date(at);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** One searchable line per event, with the date written out so "when is my dentist" works. */
export function eventText(e: CalEvent): string {
  const title = e.title.trim() || 'Untitled event';
  let when = e.allDay ? fmtUtcDate(e.start) : fmtDate(e.start, true);
  if (!e.allDay && e.end > e.start) {
    const sameDay = new Date(e.start).toDateString() === new Date(e.end).toDateString();
    when += `–${sameDay ? hhmm(new Date(e.end)) : fmtDate(e.end, true)}`;
  } else if (e.allDay) {
    when += ' (all day)';
  }
  const parts = [`Calendar event: ${title} on ${when}`];
  if (e.location?.trim()) parts.push(`at ${e.location.trim()}`);
  let text = parts.join(' ');
  const notes = e.notes?.replace(/\s+/g, ' ').trim();
  if (notes) text += `. Notes: ${notes.slice(0, 500)}`;
  return text;
}

export function eventItem(e: CalEvent): SourceItem {
  const text = eventText(e);
  return { key: `cal:${e.id}@${e.start}`, ver: hash(`${text}|${e.end}`), at: e.start, text };
}

// --- Notifications ---

export type NotificationEntry = {
  at: number;
  pkg: string;
  app?: string | null;
  title?: string | null;
  text?: string | null;
  category?: string | null;
};

/** Categories that are status, not content (music players, downloads, calls ringing…). */
const SKIP_CATEGORIES = new Set([
  'transport',
  'progress',
  'service',
  'sys',
  'call',
  'alarm',
  'stopwatch',
  'navigation',
  'missed_call',
  'location_sharing',
]);

/** Looks like a one-time code: never keep those. */
const ONE_TIME_CODE = /\b(code|otp|passcode|verification|verify|2fa|one[- ]time)\b/i;

/** The memory text for a notification, or null to skip it. */
export function notificationText(e: NotificationEntry, ownPackage?: string): string | null {
  if (ownPackage && e.pkg === ownPackage) return null;
  if (e.category && SKIP_CATEGORIES.has(e.category)) return null;
  const title = (e.title ?? '').replace(/\s+/g, ' ').trim();
  const body = (e.text ?? '').replace(/\s+/g, ' ').trim();
  if (!body && !title) return null;
  if (ONE_TIME_CODE.test(`${title} ${body}`) && /\d{4,}/.test(`${title} ${body}`)) return null;
  const app = (e.app ?? '').trim() || e.pkg;
  const content = title && body && !body.startsWith(title) ? `${title}: ${body}` : body || title;
  return `Notification from ${app}: ${content.slice(0, 1000)}`;
}

/** The same notification re-posted (updates, re-alerts) is kept once. */
export function notificationKey(e: NotificationEntry, text: string): string {
  return `notif:${e.pkg}:${hash(text)}`;
}

// --- Contacts ---

export type ContactRow = { name: string; phones: { label: string | null; number: string }[] };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Contacts matching a spoken name: exact full name first, else every contact containing all its words. */
export function findContacts(name: string, contacts: ContactRow[]): ContactRow[] {
  const n = norm(name);
  if (!n) return [];
  const exact = contacts.filter((c) => norm(c.name) === n);
  if (exact.length) return exact;
  const words = n.split(' ');
  return contacts.filter((c) => {
    const cw = norm(c.name).split(' ');
    return words.every((w) => cw.includes(w));
  });
}

/** A spoken answer to "what's X's number", from contacts only (no model needed). */
export function numberAnswer(name: string, contacts: ContactRow[]): string {
  const found = findContacts(name, contacts).filter((c) => c.phones.length);
  if (!found.length) return `I couldn't find a phone number for ${name} in your contacts.`;
  if (found.length > 3)
    return `${found.length} contacts match ${name}: ${found
      .slice(0, 3)
      .map((c) => c.name)
      .join(', ')}… Say the full name.`;
  return found
    .map((c) => {
      const phones = c.phones
        .slice(0, 3)
        .map((p) => (p.label ? `${p.number} (${p.label})` : p.number))
        .join(', ');
      return `${c.name}: ${phones}.`;
    })
    .join(' ');
}

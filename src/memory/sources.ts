import { Directory, File } from 'expo-file-system';
import { Platform } from 'react-native';

import SidekickNative from '../../modules/sidekick-native';
import { modelPath } from '@/engine/downloads';
import { OCR_FILES } from '@/engine/models';
import { ocrReady } from '@/engine/photo-ocr';
import { getSettings, updateSettings } from '@/engine/settings';
import { readPdfPages } from './pdf-read';
import { getDb } from './db';
import {
  CALENDAR_AHEAD_MS,
  CALENDAR_PAST_MS,
  type ContactRow,
  eventItem,
  type Existing,
  FILE_LIMITS,
  fileItems,
  fileKeyPrefix,
  folderKeyPrefix,
  indexableKind,
  isDue,
  notificationKey,
  notificationText,
  numberAnswer,
  askedNumberOf,
  PDF_LIMITS,
  pdfUnchanged,
  pdfVer,
  planSync,
  retentionCutoff,
  type NotificationEntry,
  type SourceItem,
  type SourceKind,
  type SyncedSource,
} from './sources-logic';
import { deleteKind, deleteMoment } from './store';

/**
 * "Your data sources": notes, picked folders, calendar, contacts and (Android) notifications.
 * Each is off until the user turns it on. Imported items are ordinary moments in the encrypted
 * database (kinds note / file / event / notification), so search and embedding work as for
 * anything heard; contacts live in their own table and are used for names and phone numbers.
 */

const isAndroid = Platform.OS === 'android';

// Loaded only when a source is used: nothing extra at app start for people who never turn them on.
const calendarApi = () => import('expo-calendar');
const contactsApi = () => import('expo-contacts');

let indexed = false;
async function db() {
  const d = await getDb();
  if (!indexed) {
    await d.execute('CREATE INDEX IF NOT EXISTS moments_source_key ON moments(source_key)');
    indexed = true;
  }
  return d;
}

async function existingUnder(prefix: string): Promise<Existing[]> {
  const d = await db();
  // substr instead of LIKE: content:// URIs contain % and _.
  const r = await d.execute(
    'SELECT id, source_key, source_ver FROM moments WHERE source_key IS NOT NULL AND substr(source_key, 1, ?) = ?',
    [prefix.length, prefix],
  );
  return r.rows.map((x) => ({
    id: x.id as number,
    key: x.source_key as string,
    ver: (x.source_ver as string | null) ?? null,
  }));
}

/** Makes the stored items under [prefix] match [incoming]; returns how many changed. */
async function syncItems(
  kind: SourceKind,
  prefix: string,
  incoming: SourceItem[],
  now = Date.now(),
): Promise<number> {
  const cutoff = retentionCutoff(getSettings().retentionDays, now);
  const plan = planSync(
    await existingUnder(prefix),
    incoming.filter((i) => i.at >= cutoff),
  );
  const d = await db();
  await d.transaction(async (tx) => {
    for (const i of plan.insert) {
      await tx.execute(
        'INSERT INTO moments (kind, at, text, source_key, source_ver) VALUES (?, ?, ?, ?, ?)',
        [kind, i.at, i.text, i.key, i.ver],
      );
    }
    for (const u of plan.update) {
      await tx.execute(
        'UPDATE moments SET text = ?, at = ?, source_ver = ?, embedded = 0 WHERE id = ?',
        [u.text, u.at, u.ver, u.id],
      );
    }
  });
  for (const id of plan.remove) await deleteMoment(id);
  const n = plan.insert.length + plan.update.length + plan.remove.length;
  if (n)
    console.log(
      `[sources] ${kind}: +${plan.insert.length} ~${plan.update.length} -${plan.remove.length}`,
    );
  return n;
}

async function lastRun(source: SyncedSource): Promise<number | null> {
  const d = await db();
  const r = await d.execute('SELECT value FROM meta WHERE key = ?', [`sync.${source}`]);
  const v = r.rows[0]?.value as string | undefined;
  return v ? Number(v) : null;
}

async function markRun(source: SyncedSource, at: number | null) {
  const d = await db();
  if (at == null) await d.execute('DELETE FROM meta WHERE key = ?', [`sync.${source}`]);
  else
    await d.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      `sync.${source}`,
      String(at),
    ]);
}

// --- Notes ---

/** Saves a typed note as a memory. */
export async function addNote(text: string, at = Date.now()) {
  const t = text.trim();
  if (!t) return;
  const d = await db();
  await d.execute('INSERT INTO moments (kind, at, text) VALUES (?, ?, ?)', ['note', at, t]);
}

export async function countKind(kind: SourceKind): Promise<number> {
  const d = await db();
  const r = await d.execute('SELECT COUNT(*) AS n FROM moments WHERE kind = ?', [kind]);
  return (r.rows[0]?.n as number | undefined) ?? 0;
}

// --- Folders ---

/** Lets the user pick a folder (system picker; access is kept across restarts). */
export async function pickFolder(): Promise<string | null> {
  try {
    const dir = await Directory.pickDirectoryAsync();
    const uris = getSettings().folderUris;
    if (!uris.includes(dir.uri)) updateSettings({ folderUris: [...uris, dir.uri] });
    await markRun('folders', null);
    return dir.uri;
  } catch (e) {
    // Cancelled.
    console.log(`[sources] folder pick: ${String(e)}`);
    return null;
  }
}

export async function removeFolder(uri: string) {
  updateSettings({ folderUris: getSettings().folderUris.filter((u) => u !== uri) });
  await (await db()).execute('DELETE FROM meta WHERE key = ?', [`pdf.empty.${uri}`]);
  for (const e of await existingUnder(folderKeyPrefix(uri))) await deleteMoment(e.id);
}

/** A readable name for a picked folder URI. */
export function folderLabel(uri: string): string {
  const last = decodeURIComponent(uri).split(/[/:]/).filter(Boolean).pop();
  return last ?? uri;
}

type FoundFile = { file: File; path: string; kind: 'text' | 'pdf' };

function walk(dir: Directory, path: string, depth: number, out: FoundFile[]) {
  if (depth > FILE_LIMITS.maxDepth || out.length >= FILE_LIMITS.maxFiles) return;
  let items: (Directory | File)[] = [];
  try {
    items = dir.list();
  } catch (e) {
    console.log(`[sources] can't list ${path}: ${String(e)}`);
    return;
  }
  for (const item of items) {
    if (out.length >= FILE_LIMITS.maxFiles) return;
    const p = path ? `${path}/${item.name}` : item.name;
    if (item instanceof Directory) {
      if (!item.name.startsWith('.')) walk(item, p, depth + 1, out);
      continue;
    }
    // PDFs need the native PDF reader (Android).
    const kind = indexableKind(item.name, item.size, isAndroid);
    if (kind) out.push({ file: item, path: p, kind });
  }
}

/** A PDF's text, page by page, on the native side (Android): embedded text, else OCR. */
async function readPdf(uri: string) {
  const ocr = ocrReady();
  const t0 = Date.now();
  const r = await readPdfPages({
    pageText: (i) => SidekickNative.pdfPageText(uri, i),
    pageOcr: ocr
      ? async (i) =>
          (
            await SidekickNative.pdfPageOcr(
              uri,
              i,
              modelPath(OCR_FILES.det),
              modelPath(OCR_FILES.rec),
              modelPath(OCR_FILES.dict),
            )
          ).lines
      : null,
  });
  console.log(
    `[sources] pdf: ${r.text.length} chars, ${r.ocrPages} OCR pages, ${Date.now() - t0} ms`,
  );
  return r;
}

/** PDFs that had no readable text, by URI → version, so scans don't OCR them every time. */
async function emptyPdfs(folderUri: string): Promise<Record<string, string>> {
  const d = await db();
  const r = await d.execute('SELECT value FROM meta WHERE key = ?', [`pdf.empty.${folderUri}`]);
  try {
    return JSON.parse((r.rows[0]?.value as string | undefined) ?? '{}');
  } catch {
    return {};
  }
}

async function saveEmptyPdfs(folderUri: string, map: Record<string, string>) {
  const d = await db();
  await d.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    `pdf.empty.${folderUri}`,
    JSON.stringify(map),
  ]);
}

async function syncFolder(folderUri: string): Promise<number> {
  const root = new Directory(folderUri);
  const files: FoundFile[] = [];
  walk(root, folderLabel(folderUri), 0, files);
  const existing = await existingUnder(folderKeyPrefix(folderUri));
  const hasPdfs = files.some((f) => f.kind === 'pdf');
  const ocr = hasPdfs && ocrReady();
  const wasEmpty = await emptyPdfs(folderUri);
  const nowEmpty: Record<string, string> = {};
  let ocrPages = 0;
  const incoming: SourceItem[] = [];
  for (const { file, path, kind } of files) {
    const modified = file.modificationTime ?? 0;
    const prefix = fileKeyPrefix(folderUri, file.uri);
    const old = existing.filter((e) => e.key.startsWith(prefix));
    const keepOld = () =>
      old.forEach((e) => incoming.push({ key: e.key, ver: e.ver!, at: modified, text: '' }));
    if (kind === 'text' && old.length && old.every((e) => e.ver === String(modified))) {
      // Unchanged since the last scan: keep as is without reading it.
      keepOld();
      continue;
    }
    if (kind === 'pdf') {
      const vers = old.map((e) => e.ver);
      const emptyVer = wasEmpty[file.uri];
      if (emptyVer != null && pdfUnchanged([emptyVer], modified, ocr)) {
        nowEmpty[file.uri] = emptyVer;
        continue;
      }
      if (pdfUnchanged(vers, modified, ocr)) {
        keepOld();
        continue;
      }
      // Enough OCR for one scan: the rest (and their old passages) wait for the next.
      if (ocrPages >= PDF_LIMITS.ocrPagesPerScan) {
        keepOld();
        if (emptyVer != null) nowEmpty[file.uri] = emptyVer;
        continue;
      }
      try {
        const r = await readPdf(file.uri);
        ocrPages += r.ocrPages;
        const ver = pdfVer(modified, r.complete);
        const items = fileItems(
          folderUri,
          file.uri,
          path,
          modified,
          r.text,
          ver,
          PDF_LIMITS.maxChunks,
        );
        if (!items.length) nowEmpty[file.uri] = ver;
        incoming.push(...items);
      } catch (e) {
        // Password-protected, damaged, or not seekable (some cloud folders).
        console.log(`[sources] can't read ${path}: ${String(e)}`);
      }
      continue;
    }
    try {
      incoming.push(...fileItems(folderUri, file.uri, path, modified, await file.text()));
    } catch (e) {
      console.log(`[sources] can't read ${path}: ${String(e)}`);
    }
  }
  if (hasPdfs || Object.keys(wasEmpty).length) await saveEmptyPdfs(folderUri, nowEmpty);
  return syncItems('file', folderKeyPrefix(folderUri), incoming);
}

export async function syncFolders(): Promise<number> {
  let n = 0;
  for (const uri of getSettings().folderUris) {
    try {
      n += await syncFolder(uri);
    } catch (e) {
      console.log(`[sources] folder sync failed: ${String(e)}`);
    }
  }
  return n;
}

// --- Calendar ---

export async function requestCalendar(): Promise<boolean> {
  const Calendar = await calendarApi();
  return (await Calendar.requestCalendarPermissions()).status === 'granted';
}

export async function syncCalendar(now = Date.now()): Promise<number> {
  const Calendar = await calendarApi();
  if ((await Calendar.getCalendarPermissions()).status !== 'granted') return 0;
  const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  if (!cals.length) return syncItems('event', 'cal:', []);
  const events = await Calendar.listEvents(
    cals.map((c) => c.id),
    new Date(now - CALENDAR_PAST_MS),
    new Date(now + CALENDAR_AHEAD_MS),
  );
  const items = events.map((e) =>
    eventItem({
      id: e.id,
      title: e.title ?? '',
      start: new Date(e.startDate).getTime(),
      end: new Date(e.endDate).getTime(),
      allDay: !!e.allDay,
      location: e.location ?? null,
      notes: e.notes ?? null,
    }),
  );
  return syncItems('event', 'cal:', items, now);
}

// --- Contacts ---

export async function requestContacts(): Promise<boolean> {
  const Contacts = await contactsApi();
  return (await Contacts.requestPermissionsAsync()).status === 'granted';
}

export async function syncContacts(): Promise<number> {
  const Contacts = await contactsApi();
  if ((await Contacts.getPermissionsAsync()).status !== 'granted') return 0;
  const all = await Contacts.Contact.getAllDetails([
    Contacts.ContactField.FULL_NAME,
    Contacts.ContactField.PHONES,
  ] as const);
  const rows = all
    .map((c) => ({
      id: String(c.id),
      name: (c.fullName ?? '').trim(),
      phones: (c.phones ?? [])
        .filter((p) => p.number)
        .map((p) => ({ label: p.label ?? null, number: String(p.number) })),
    }))
    .filter((c) => c.name);
  const d = await db();
  await d.transaction(async (tx) => {
    await tx.execute('DELETE FROM contacts');
    for (const c of rows) {
      await tx.execute('INSERT OR REPLACE INTO contacts (id, name, phones) VALUES (?, ?, ?)', [
        c.id,
        c.name,
        JSON.stringify(c.phones),
      ]);
    }
  });
  console.log(`[sources] contacts: ${rows.length}`);
  return rows.length;
}

async function contactRows(): Promise<ContactRow[]> {
  const d = await db();
  const r = await d.execute('SELECT name, phones FROM contacts ORDER BY name');
  return r.rows.map((x) => ({
    name: x.name as string,
    phones: JSON.parse((x.phones as string) || '[]'),
  }));
}

/** Contact names (empty unless contacts are on), e.g. to suggest a name for a voice. */
export async function contactNames(): Promise<string[]> {
  if (!getSettings().sourceContacts) return [];
  return (await contactRows()).map((c) => c.name);
}

export async function clearContacts() {
  const d = await db();
  await d.execute('DELETE FROM contacts');
  await markRun('contacts', null);
}

/** Questions answered straight from the phone's data, with no model: "what's Sam's number". */
export async function answerLocally(question: string): Promise<string | null> {
  if (!getSettings().sourceContacts) return null;
  const who = askedNumberOf(question);
  if (!who) return null;
  try {
    return numberAnswer(who, await contactRows());
  } catch {
    return null;
  }
}

// --- Notifications (Android) ---

export function notificationAccessGranted(): boolean {
  return isAndroid && SidekickNative.notificationAccessGranted();
}

export function openNotificationAccess() {
  if (isAndroid) SidekickNative.openNotificationAccessSettings();
}

export function setNotificationCapture(enabled: boolean) {
  if (isAndroid) SidekickNative.notificationsSetCapture(enabled);
}

/** Moves notifications the listener kept into memory (each distinct text once). */
export async function ingestNotifications(): Promise<number> {
  if (!isAndroid) return 0;
  const lines = SidekickNative.notificationsDrain();
  if (!lines.length || !getSettings().sourceNotifications) return 0;
  const d = await db();
  const cutoff = retentionCutoff(getSettings().retentionDays, Date.now());
  let added = 0;
  for (const line of lines) {
    let e: NotificationEntry;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    // The listener already skips Sidekick's own notifications.
    const text = notificationText(e);
    if (!text || e.at < cutoff) continue;
    const key = notificationKey(e, text);
    const r = await d.execute('SELECT 1 FROM moments WHERE source_key = ? LIMIT 1', [key]);
    if (r.rows.length) continue;
    await d.execute(
      'INSERT INTO moments (kind, at, text, source_key, source_ver) VALUES (?, ?, ?, ?, ?)',
      ['notification', e.at, text, key, '1'],
    );
    added++;
  }
  return added;
}

// --- Scheduling ---

/** Re-reads whichever enabled sources are due. Cheap when nothing is due; call when idle. */
export async function syncSourcesIfDue(now = Date.now()): Promise<number> {
  const s = getSettings();
  let n = 0;
  const run = async (on: boolean, source: SyncedSource, fn: () => Promise<number>) => {
    if (!on || !isDue(source, await lastRun(source), now)) return;
    try {
      n += await fn();
    } catch (e) {
      console.log(`[sources] ${source} sync failed: ${String(e)}`);
    }
    await markRun(source, now);
  };
  try {
    n += await ingestNotifications();
  } catch (e) {
    console.log(`[sources] notifications failed: ${String(e)}`);
  }
  await run(s.sourceFolders && s.folderUris.length > 0, 'folders', syncFolders);
  await run(s.sourceCalendar, 'calendar', () => syncCalendar(now));
  await run(s.sourceContacts, 'contacts', syncContacts);
  return n;
}

/** Re-scans one source now (e.g. right after it is turned on). */
export async function syncNow(source: SyncedSource): Promise<number> {
  await markRun(source, null);
  const fn = { folders: syncFolders, calendar: () => syncCalendar(), contacts: syncContacts }[
    source
  ];
  const n = await fn();
  await markRun(source, Date.now());
  return n;
}

/** Deletes everything one source added and turns it off, so a re-scan doesn't bring it back. */
export async function deleteSource(
  source: 'notes' | 'folders' | 'calendar' | 'contacts' | 'notifications',
) {
  updateSettings(
    {
      notes: { sourceNotes: false },
      folders: { sourceFolders: false },
      calendar: { sourceCalendar: false },
      contacts: { sourceContacts: false },
      notifications: { sourceNotifications: false },
    }[source],
  );
  if (source === 'notifications') setNotificationCapture(false);
  switch (source) {
    case 'notes':
      return deleteKind('note');
    case 'folders':
      await deleteKind('file');
      return markRun('folders', null);
    case 'calendar':
      await deleteKind('event');
      return markRun('calendar', null);
    case 'contacts':
      return clearContacts();
    case 'notifications':
      if (isAndroid) SidekickNative.notificationsDrain();
      return deleteKind('notification');
  }
}

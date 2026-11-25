/**
 * "Back up to Google Drive": uploads the export file (made by the Storage/Privacy export) to the
 * user's Drive with the drive.file scope, so Sidekick sees only files it created. Keeps the last
 * two backups: each new one replaces the older of the two (same file id) instead of piling up.
 */
import { googleConfigured, googleFetch } from './google';
import { isOn } from './prefs';

// gitleaks:allow (storage key names, not secrets)
const SLOT_KEYS = ['driveBackup.fileId', 'driveBackup.fileId.1'] as const;
const NEXT_KEY = 'driveBackup.nextSlot';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export type Kv = { get(k: string): string | null; set(k: string, v: string): void };

function kv(): Kv {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const n = require('../../modules/sidekick-native').default;
  return { get: (k) => n.kvGet(k), set: (k, v) => n.kvSet(k, v) };
}

/** Resumable-upload session URL: PATCH the earlier backup if we have one, else create. */
export function sessionRequest(
  name: string,
  fileId: string | null,
): { url: string; method: 'POST' | 'PATCH'; body: string } {
  return fileId
    ? {
        url: `${UPLOAD}/${fileId}?uploadType=resumable`,
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }
    : {
        url: `${UPLOAD}?uploadType=resumable`,
        method: 'POST',
        body: JSON.stringify({ name, mimeType: 'application/zip' }),
      };
}

/** Which of the two backup files the next one replaces (the older; slot 0 first). */
export function nextSlot(store: Kv): 0 | 1 {
  return store.get(NEXT_KEY) === '1' ? 1 : 0;
}

/** "Sidekick backup 2026-11-25.zip" */
export function backupName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Sidekick backup ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.zip`;
}

/** Uploads [filePath] (a local zip) over the older of the two backups. Returns the Drive file id. */
export async function backupToDrive(
  filePath: string,
  name = backupName(),
  f: typeof fetch = fetch,
  store: Kv = kv(),
): Promise<string> {
  if (!googleConfigured() || !isOn('driveBackup', 'backup'))
    throw new Error('Google Drive backup is off');
  const slot = nextSlot(store);
  let fileId = store.get(SLOT_KEYS[slot]);
  let req = sessionRequest(name, fileId);
  let res = await googleFetch(
    'drive',
    req.url,
    {
      method: req.method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: req.body,
    },
    f,
  );
  if (res.status === 404 && fileId) {
    // The earlier backup was deleted in Drive: start a new file.
    fileId = null;
    req = sessionRequest(name, null);
    res = await googleFetch(
      'drive',
      req.url,
      {
        method: req.method,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: req.body,
      },
      f,
    );
  }
  if (!res.ok) throw new Error(`Google Drive error ${res.status}`);
  const session = res.headers.get('location');
  if (!session) throw new Error('Google Drive did not start the upload');
  const { File } = await import('expo-file-system');
  const up = await new File(filePath).upload(session, {
    httpMethod: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
  });
  if (up.status < 200 || up.status >= 300)
    throw new Error(`Google Drive upload failed (${up.status})`);
  const id = (JSON.parse(up.body) as { id: string }).id;
  store.set(SLOT_KEYS[slot], id);
  store.set(NEXT_KEY, slot === 0 ? '1' : '0');
  return id;
}

export const BACKUP_EVERY_MS = 7 * 86_400_000;
/** After a failed automatic backup, wait this long before trying again. */
export const RETRY_AFTER_MS = 6 * 3_600_000;

/** The weekly automatic backup: a week since the last one, on Wi-Fi and charging. */
export function backupDue(o: {
  lastAt: number | null;
  lastTryAt: number | null;
  now: number;
  wifi: boolean;
  charging: boolean;
}): boolean {
  if (!o.wifi || !o.charging) return false;
  if (o.lastTryAt != null && o.now - o.lastTryAt < RETRY_AFTER_MS) return false;
  return o.lastAt == null || o.now - o.lastAt >= BACKUP_EVERY_MS;
}

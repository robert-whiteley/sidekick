/**
 * "Back up to Google Drive": uploads the export file (made by the Storage/Privacy export) to the
 * user's Drive with the drive.file scope, so Sidekick sees only files it created. Replaces the
 * previous backup (same file id) instead of piling up copies.
 */
import { googleConfigured, googleFetch } from './google';
import { isOn } from './prefs';

const META_KEY = 'driveBackup.fileId';
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

/** Uploads [filePath] (a local zip). Returns the Drive file id. */
export async function backupToDrive(
  filePath: string,
  name = 'Sidekick backup.zip',
  f: typeof fetch = fetch,
  store: Kv = kv(),
): Promise<string> {
  if (!googleConfigured() || !isOn('driveBackup', 'backup'))
    throw new Error('Google Drive backup is off');
  let fileId = store.get(META_KEY);
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
  store.set(META_KEY, id);
  return id;
}

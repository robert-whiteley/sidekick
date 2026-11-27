/**
 * What each deletion removes, in counts and sizes, for the delete confirmation
 * (delete-confirm.ts). The same lines whether the delete was started from Settings or by
 * voice or chat (app-settings.ts), so the app behaves the same everywhere.
 */
import { requestDelete } from './delete-confirm';
import { platformText } from './platform-text';
import { PICTURE_FILES } from './models';
import { formatBytes, type StorageKind } from './storage';
import { measureUsageNow } from './storage-monitor';
import { countMoments } from '@/memory/store';
import { trackSize } from '@/memory/places-store';
import { countKind } from '@/memory/sources';

export type DeleteWhat =
  | { kind: 'range'; from: number; to: number; label: string }
  | {
      kind: 'source';
      source: 'notes' | 'folders' | 'calendar' | 'contacts' | 'notifications';
    }
  | { kind: 'everything' }
  | { kind: 'pictureModel' }
  | { kind: 'folder'; label: string }
  | { kind: 'keep'; media: StorageKind | 'memories'; line: string; before?: number }
  | { kind: 'routine'; label: string }
  | { kind: 'locationHistory' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const memories = (n: number) => plural(n, 'memory', 'memories');
const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await f();
  } catch {
    return fallback;
  }
};

const SOURCE_KIND = {
  notes: { kind: 'note', one: 'note', many: 'notes', title: 'notes' },
  folders: {
    kind: 'file',
    one: 'passage read from folders',
    many: 'passages read from folders',
    title: 'files read from folders',
  },
  calendar: {
    kind: 'event',
    one: 'calendar event',
    many: 'calendar events',
    title: 'calendar events',
  },
  contacts: { kind: null, one: '', many: '', title: 'the contacts copy' },
  notifications: {
    kind: 'notification',
    one: 'kept notification',
    many: 'kept notifications',
    title: 'notifications',
  },
} as const;

/** The sheet's title and lines for [w]. */
export async function deleteLines(
  w: DeleteWhat,
): Promise<{ title: string; lines: string[]; exportFirst: boolean }> {
  switch (w.kind) {
    case 'range': {
      const n = await safe(() => countMoments(w.from, w.to), -1);
      return {
        title: `Delete ${w.label}?`,
        lines: [
          n >= 0
            ? `${memories(n)} from ${w.label} are deleted: what was heard, said, seen and asked.`
            : `Everything from ${w.label} is deleted.`,
        ],
        exportFirst: n !== 0,
      };
    }
    case 'source': {
      const k = SOURCE_KIND[w.source];
      const kind = k.kind;
      const n = kind ? await safe(() => countKind(kind), -1) : -1;
      return {
        title: `Delete ${k.title}?`,
        lines: [
          n >= 0
            ? `${plural(n, k.one, k.many)} deleted.`
            : `Everything kept from ${k.title} is deleted.`,
          'The source is turned off. The originals on your phone are not touched.',
        ],
        exportFirst: n !== 0,
      };
    }
    case 'everything': {
      const u = await safe(measureUsageNow, null);
      const n = await safe(() => countMoments(0, Date.now() + 60_000), -1);
      const total = u ? Object.values(u).reduce((a, b) => a + b, 0) : 0;
      return {
        title: 'Delete everything?',
        lines: [
          ...(n >= 0 ? [`${memories(n)}.`] : []),
          ...(u ? [`${formatBytes(total)} of photos, video, audio, text and models.`] : []),
          platformText('deleteAllBody'),
        ],
        exportFirst: true,
      };
    }
    case 'pictureModel': {
      const bytes = PICTURE_FILES.model.bytes + PICTURE_FILES.decoder.bytes;
      return {
        title: 'Delete the picture model?',
        lines: [
          `The picture model (${formatBytes(bytes)}) is deleted. Pictures already made stay.`,
        ],
        exportFirst: false,
      };
    }
    case 'folder':
      return {
        title: 'Remove this folder?',
        lines: [
          `What Sidekick read from “${w.label}” is deleted from its index.`,
          'Your files are not touched.',
        ],
        exportFirst: false,
      };
    case 'keep': {
      const u = w.media === 'memories' ? null : await safe(measureUsageNow, null);
      const n =
        w.media === 'memories' && w.before ? await safe(() => countMoments(0, w.before!), -1) : -1;
      const size = u && w.media !== 'memories' ? u[w.media] : 0;
      return {
        title: 'Keep less?',
        lines: [
          w.line,
          ...(n >= 0 ? [`${memories(n)} are that old now.`] : []),
          ...(size ? [`All of it takes ${formatBytes(size)} now; the older part is deleted.`] : []),
        ],
        exportFirst: true,
      };
    }
    case 'locationHistory': {
      const n = await safe(trackSize, -1);
      return {
        title: 'Delete location history?',
        lines: [
          n >= 0
            ? `${plural(n, 'remembered position')} and the town names on your memories are deleted.`
            : 'Every remembered position and the town names on your memories are deleted.',
          'Your named places stay.',
        ],
        exportFirst: false,
      };
    }
    case 'routine':
      return {
        title: 'Delete this routine?',
        lines: [`The routine “${w.label}” is deleted.`],
        exportFirst: false,
      };
  }
}

/** Opens the delete confirmation for [w]; [run] deletes once DELETE is typed. */
export async function askToDelete(w: DeleteWhat, run: () => Promise<void> | void) {
  requestDelete({ ...(await deleteLines(w)), run });
}

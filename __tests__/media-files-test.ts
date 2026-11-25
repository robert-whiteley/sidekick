import { keptFile, pruneMissingMedia } from '@/memory/media-files';

const mockExists = jest.fn((p: string) => !p.includes('gone'));
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: { fileExists: (p: string) => mockExists(p) },
}));

type Row = { id: number; photo_path: string | null; audio_path: string | null };
let rows: Row[] = [];
const mockExecute = jest.fn(async (sql: string, params: unknown[]) => {
  if (sql.startsWith('SELECT')) {
    const [after, limit] = params as [number, number];
    return {
      rows: rows.filter((r) => (r.photo_path || r.audio_path) && r.id > after).slice(0, limit),
    };
  }
  const id = params[0] as number;
  const r = rows.find((x) => x.id === id)!;
  if (sql.includes('photo_path = NULL')) r.photo_path = null;
  if (sql.includes('audio_path = NULL')) r.audio_path = null;
  return { rows: [] };
});
jest.mock('@/memory/db', () => ({ getDb: async () => ({ execute: mockExecute }) }));

test('keptFile: the path while the file is there, null once it is gone', () => {
  expect(keptFile('/a/photo.jpg')).toBe('/a/photo.jpg');
  expect(keptFile('/a/gone.jpg')).toBeNull();
  expect(keptFile(null)).toBeNull();
  expect(keptFile('file:///a/x.jpg')).toBe('file:///a/x.jpg');
  expect(mockExists).toHaveBeenLastCalledWith('/a/x.jpg');
});

test('pruneMissingMedia clears only references to missing files, keeping the memory', async () => {
  rows = [
    { id: 1, photo_path: '/gone1.jpg', audio_path: '/ok.ogg' },
    { id: 2, photo_path: null, audio_path: '/gone2.ogg' },
    { id: 3, photo_path: '/ok.jpg', audio_path: null },
  ];
  expect(await pruneMissingMedia()).toBe(2);
  expect(rows).toEqual([
    { id: 1, photo_path: null, audio_path: '/ok.ogg' },
    { id: 2, photo_path: null, audio_path: null },
    { id: 3, photo_path: '/ok.jpg', audio_path: null },
  ]);
});

test('pruneMissingMedia stops at the first full batch where every file is still there', async () => {
  rows = Array.from({ length: 1200 }, (_, i) => ({
    id: i + 1,
    photo_path: i < 10 ? `/gone${i}.jpg` : `/ok${i}.jpg`,
    audio_path: null,
  }));
  mockExecute.mockClear();
  expect(await pruneMissingMedia()).toBe(10);
  const selects = mockExecute.mock.calls.filter(([sql]) => sql.startsWith('SELECT'));
  expect(selects).toHaveLength(2); // batch 1 had missing files, batch 2 had none: stop
});

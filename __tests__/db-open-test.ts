/**
 * Opening the memory database (db.ts): one open shared by every early caller (two at once made two
 * keys on the first run and an unreadable file at the next start), a file its key can't read is
 * set aside for a new one, and nothing re-creates the file while "Delete all my data" wipes it.
 */
// The first test also loads (transforms) the modules, slow when many suites run at once.
jest.setTimeout(30_000);

type FakeDb = { executeSync: jest.Mock; close: jest.Mock; getDbPath: () => string };

const mockOpen = jest.fn();
jest.mock('@op-engineering/op-sqlite', () => ({ open: (...a: unknown[]) => mockOpen(...a) }));

let mockKeychain: string | null = null;
const mockSetItem = jest.fn(async (_k: string, v: string) => {
  // The keychain answers later than the callers ask: the race needs a real wait.
  await new Promise((r) => setTimeout(r, 5));
  mockKeychain = v;
});
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 0,
  getItemAsync: async () => {
    await new Promise((r) => setTimeout(r, 5));
    return mockKeychain;
  },
  setItemAsync: (k: string, v: string) => mockSetItem(k, v),
}));
let mockBytes = 0;
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n).fill(++mockBytes),
}));
const mockMove = jest.fn();
let mockFiles: string[] = [];
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    exists: boolean;
    constructor(uri: string) {
      this.uri = uri;
      this.exists = mockFiles.includes(uri);
    }
    move = (to: { uri: string }) => mockMove(this.uri, to.uri);
    delete = () => {};
  },
}));

function fakeDb(opts: { readable: boolean; path?: string }): FakeDb {
  return {
    executeSync: jest.fn((sql: string) => {
      if (!opts.readable && sql.startsWith('SELECT count(*) FROM sqlite_master'))
        throw Object.assign(new Error('file is not a database'), { code: 26 });
      return { rows: [] };
    }),
    close: jest.fn(),
    getDbPath: () => opts.path ?? '/data/memory.db',
  };
}

/* eslint-disable @typescript-eslint/no-require-imports -- a fresh module per test (its state) */
const loadDb = () => require('@/memory/db') as typeof import('@/memory/db');
const loadNotices = () => require('@/engine/notices') as typeof import('@/engine/notices');
/* eslint-enable @typescript-eslint/no-require-imports */

beforeEach(() => {
  jest.resetModules();
  mockOpen.mockReset();
  mockSetItem.mockClear();
  mockMove.mockClear();
  mockKeychain = null;
  mockFiles = ['file:///data/memory.db'];
});

test('first run: callers at the same moment share one open and one key', async () => {
  mockOpen.mockImplementation(() => fakeDb({ readable: true }));
  const { getDb } = loadDb();
  const [a, b, c] = await Promise.all([getDb(), getDb(), getDb()]);
  expect(mockOpen).toHaveBeenCalledTimes(1);
  expect(mockSetItem).toHaveBeenCalledTimes(1);
  expect(a).toBe(b);
  expect(b).toBe(c);
  expect(await getDb()).toBe(a);
  // A second connection would wait for a lock, not fail at once.
  expect(a.executeSync).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000');
});

test('later starts reuse the stored key and make no new one', async () => {
  mockKeychain = 'ab'.repeat(32);
  mockOpen.mockImplementation(() => fakeDb({ readable: true }));
  const { getDb } = loadDb();
  await getDb();
  expect(mockSetItem).not.toHaveBeenCalled();
  expect(mockOpen.mock.calls[0][0]).toMatchObject({ encryptionKey: 'ab'.repeat(32) });
});

test('a file its key cannot read is set aside and a new memory starts, with a notice', async () => {
  mockKeychain = 'cd'.repeat(32);
  const bad = fakeDb({ readable: false });
  const good = fakeDb({ readable: true });
  mockOpen.mockReturnValueOnce(bad).mockReturnValueOnce(good);
  const { getDb } = loadDb();
  const { notices } = loadNotices();
  expect(await getDb()).toBe(good);
  expect(bad.close).toHaveBeenCalled();
  expect(mockMove).toHaveBeenCalledWith(
    'file:///data/memory.db',
    expect.stringMatching(/^file:\/\/\/data\/memory\.db\.unreadable-\d+$/),
  );
  expect(notices.all.map((n) => n.key)).toContain('memory-reset');
});

test('other open errors are not mistaken for a lost key', async () => {
  mockKeychain = 'ef'.repeat(32);
  mockOpen.mockImplementation(() => ({
    ...fakeDb({ readable: true }),
    executeSync: () => {
      throw new Error('disk I/O error');
    },
  }));
  const { getDb } = loadDb();
  await expect(getDb()).rejects.toThrow('disk I/O error');
  expect(mockMove).not.toHaveBeenCalled();
});

test('after closeDb (Delete all my data) nothing opens the file again', async () => {
  mockOpen.mockImplementation(() => fakeDb({ readable: true }));
  const { getDb, closeDb } = loadDb();
  await getDb();
  closeDb();
  await expect(getDb()).rejects.toThrow(/being deleted/);
  expect(mockOpen).toHaveBeenCalledTimes(1);
});

test('the file goes aside with its journal files, its path encoded (a space on iPhone)', async () => {
  mockKeychain = 'cd'.repeat(32);
  const dir = '/var/app/Library/Application Support/sidekick/data';
  const enc = 'file:///var/app/Library/Application%20Support/sidekick/data/memory.db';
  mockFiles = [enc, `${enc}-wal`, `${enc}-shm`];
  mockOpen
    .mockReturnValueOnce(fakeDb({ readable: false, path: `${dir}/memory.db` }))
    .mockReturnValueOnce(fakeDb({ readable: true }));
  const { getDb } = loadDb();
  await getDb();
  const moved = mockMove.mock.calls.map((c) => c[0]);
  expect(moved).toEqual([enc, `${enc}-wal`, `${enc}-shm`]);
  expect(mockMove.mock.calls[1][1]).toMatch(/memory\.db\.unreadable-\d+-wal$/);
});

test('a new file that still cannot be read fails plainly, without a new-memory notice', async () => {
  mockKeychain = 'cd'.repeat(32);
  mockOpen.mockImplementation(() => fakeDb({ readable: false }));
  const { getDb } = loadDb();
  const { notices } = loadNotices();
  await expect(getDb()).rejects.toThrow(/could not be opened either/);
  expect(notices.all.map((n) => n.key)).not.toContain('memory-reset');
});

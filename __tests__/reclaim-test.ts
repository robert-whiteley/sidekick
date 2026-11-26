import { CHUNK_SLOTS, needsRebuild, reclaimSpace, vacuumWorthIt } from '@/memory/reclaim';

const mockExecute = jest.fn();
const mockTx = jest.fn();
jest.mock('@/memory/db', () => ({
  getDb: async () => ({
    execute: mockExecute,
    transaction: async (fn: (tx: { execute: typeof mockExecute }) => Promise<void>) => {
      mockTx();
      await fn({ execute: mockExecute });
    },
  }),
  vecTableSql: (n: string) => `CREATE VIRTUAL TABLE IF NOT EXISTS ${n} USING vec0(...)`,
}));

describe('needsRebuild', () => {
  it('waits for a whole chunk of dead slots', () => {
    expect(needsRebuild(2048, 2048 - CHUNK_SLOTS + 1)).toBe(false);
    expect(needsRebuild(2048, 2048 - CHUNK_SLOTS)).toBe(true);
  });
  it('forced: any dead slot', () => {
    expect(needsRebuild(1024, 1023, true)).toBe(true);
    expect(needsRebuild(1024, 1024, true)).toBe(false);
  });
});

describe('vacuumWorthIt', () => {
  it('needs 1 MB and a tenth of the file free', () => {
    expect(vacuumWorthIt(900_000, 2_000_000)).toBe(false);
    expect(vacuumWorthIt(2_000_000, 30_000_000)).toBe(false);
    expect(vacuumWorthIt(5_000_000, 10_000_000)).toBe(true);
    expect(vacuumWorthIt(1, 10_000_000, true)).toBe(true);
  });
});

describe('reclaimSpace', () => {
  /** A database whose moments_vec has 7 chunks for 1,228 live rows, with 5.5 MB free. */
  const answer = (sql: string) => {
    if (sql.includes('pragma_page_size')) return 4096;
    if (sql.includes('pragma_page_count')) return 2431;
    if (sql.includes('pragma_freelist_count')) return 1400;
    if (sql.includes('moments_vec_chunks')) return 7 * 1024;
    if (sql.includes('moments_vec_rowids')) return 1228;
    if (sql.includes('photos_vec_chunks')) return 1024;
    if (sql.includes('photos_vec_rowids')) return 900;
    return 0;
  };
  beforeEach(() => {
    mockExecute.mockReset();
    mockTx.mockReset();
    mockExecute.mockImplementation(async (sql: string) => ({ rows: [{ n: answer(sql) }] }));
  });
  const sqls = () => mockExecute.mock.calls.map((c) => c[0] as string);

  it('rebuilds only the table with a chunk of dead slots, merges the word index and vacuums', async () => {
    const r = await reclaimSpace();
    expect(r.rebuilt).toEqual(['moments_vec']);
    expect(r.vacuumed).toBe(true);
    const s = sqls();
    expect(s).toContain('DROP TABLE moments_vec');
    expect(s).not.toContain('DROP TABLE photos_vec');
    expect(s.indexOf('DROP TABLE moments_vec')).toBeLessThan(
      s.findIndex((x) => x.startsWith('INSERT INTO moments_vec')),
    );
    expect(s).toContain("INSERT INTO moments_fts(moments_fts) VALUES ('optimize')");
    expect(s[s.length - 2]).toBe('VACUUM');
    expect(mockTx).toHaveBeenCalledTimes(1);
  });

  it('forced (delete everything): rebuilds both', async () => {
    const r = await reclaimSpace({ force: true });
    expect(r.rebuilt).toEqual(['moments_vec', 'photos_vec']);
  });
});

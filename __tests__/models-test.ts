import { formatProgress, MODEL_FILES } from '@/engine/models';

test('every downloadable file has a pinned SHA-256 and size', () => {
  for (const f of Object.values(MODEL_FILES)) {
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.bytes).toBeGreaterThan(0);
    expect(f.url.startsWith('https://')).toBe(true);
    expect(f.url.endsWith(`/${f.name}`)).toBe(true);
  }
});

test('formatProgress', () => {
  expect(formatProgress(1.2e9, 2.6e9)).toBe('1.2 / 2.6 GB (46%)');
  expect(formatProgress(5e8, -1)).toBe('0.5 GB');
});

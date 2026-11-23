import { EMBEDDER_FILE, formatProgress, MODEL_FILES, OBSOLETE_MODEL_PATHS } from '@/engine/models';

test('every downloadable file has a pinned SHA-256 and size', () => {
  for (const f of Object.values(MODEL_FILES)) {
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.bytes).toBeGreaterThan(0);
    expect(f.url.startsWith('https://')).toBe(true);
    // Saved under f.name, which may add a version tag upstream leaves out (Silero ships every version as silero_vad.onnx).
    const upstream = f.url.slice(f.url.lastIndexOf('/') + 1);
    expect([f.name, f.name.replace(/_v[\d.]+(?=\.onnx$)/, '')]).toContain(upstream);
  }
  expect(OBSOLETE_MODEL_PATHS).not.toContain(MODEL_FILES.vad.name);
});

test('formatProgress', () => {
  expect(formatProgress(1.2e9, 2.6e9)).toBe('1.2 / 2.6 GB (46%)');
  expect(formatProgress(5e8, -1)).toBe('0.5 GB');
});

test('the embedder is the text+vision file and the old text-only file is cleaned up', () => {
  expect(EMBEDDER_FILE.name).toBe('embeddinggemma-2-text-vision-440m.litertlm');
  expect(EMBEDDER_FILE.url.endsWith(`/${EMBEDDER_FILE.name}`)).toBe(true);
  expect(EMBEDDER_FILE.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(OBSOLETE_MODEL_PATHS).toContain('embeddinggemma-2-text-270m.litertlm');
  expect(OBSOLETE_MODEL_PATHS).not.toContain(EMBEDDER_FILE.name);
});

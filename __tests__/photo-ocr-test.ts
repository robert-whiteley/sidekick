import { allRequiredFiles } from '@/engine/llm-candidates';
import { OCR_FILES } from '@/engine/models';
import {
  appendRead,
  appendSeen,
  formatOcr,
  MAX_READ_CHARS,
  ocrPromptLine,
} from '@/memory/photo-text';

test('OCR lines become one searchable line; noise is dropped', () => {
  expect(formatOcr(['CORNER CAFE', '  Total GBP   6.35 ', ''])).toBe(
    'CORNER CAFE · Total GBP 6.35',
  );
  expect(formatOcr([])).toBeNull();
  expect(formatOcr(['.', '|'])).toBeNull();
  expect(formatOcr(['4'])).toBeNull();
  expect(formatOcr(['G11'])).toBe('G11');
  expect(formatOcr(['登机牌'])).toBe('登机牌');
  const long = formatOcr(['word '.repeat(400)])!;
  expect(long.length).toBe(MAX_READ_CHARS);
  expect(long.endsWith('…')).toBe(true);
});

test('the Read line goes before Seen, replaces an older one, and survives a later description', () => {
  const t = appendRead('Captured photo.', 'PLATFORM 4');
  expect(t).toBe('Captured photo.\nRead: "PLATFORM 4"');
  expect(appendRead(t, 'LEEDS 14:32')).toBe('Captured photo.\nRead: "LEEDS 14:32"');
  const seen = appendSeen(t, 'Scene: a station.');
  expect(seen).toBe('Captured photo.\nRead: "PLATFORM 4"\nSeen: Scene: a station.');
  expect(appendRead(seen, 'X1 Y2')).toBe('Captured photo.\nRead: "X1 Y2"\nSeen: Scene: a station.');
  expect(appendRead('', 'Hi there')).toBe('Read: "Hi there"');
});

test('the prompt line is empty without OCR text', () => {
  expect(ocrPromptLine(null)).toBe('');
  expect(ocrPromptLine('Total 6.35')).toBe(
    'Text read from the photo by OCR (exact): "Total 6.35"\n',
  );
});

test('OCR files are pinned to a commit with sha256 and size, and downloaded on first run', () => {
  for (const f of Object.values(OCR_FILES)) {
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.bytes).toBeGreaterThan(0);
    expect(f.url).toMatch(
      /^https:\/\/huggingface\.co\/PaddlePaddle\/PP-OCRv6_small_(det|rec)_onnx\/resolve\/[0-9a-f]{40}\//,
    );
  }
  const names = allRequiredFiles('').map((f) => f.name);
  for (const f of Object.values(OCR_FILES)) expect(names).toContain(f.name);
});

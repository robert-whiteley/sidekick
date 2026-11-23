import { appendSeen, captureText, parseDescription, shouldDescribeNow } from '@/memory/photo-text';

test('parses text and scene', () => {
  expect(
    parseDescription('Text: PLATFORM 4 LEEDS 14:32\nScene: A station sign above a platform.'),
  ).toBe('Text: "PLATFORM 4 LEEDS 14:32" · Scene: A station sign above a platform.');
});

test('drops "none" text and markdown', () => {
  expect(parseDescription('**Text:** none\n**Scene:** A dog on a sofa.')).toBe(
    'Scene: A dog on a sofa.',
  );
});

test('keeps an unformatted reply', () => {
  expect(parseDescription('A red bicycle.')).toBe('A red bicycle.');
  expect(parseDescription('   ')).toBeNull();
});

test('appends the description once', () => {
  const once = appendSeen('Captured photo.', 'Scene: a cat.');
  expect(once).toBe('Captured photo.\nSeen: Scene: a cat.');
  expect(appendSeen(once, 'Scene: a dog.')).toBe('Captured photo.\nSeen: Scene: a dog.');
});

test('only describes when idle and not draining the battery', () => {
  const base = {
    llmLoaded: true,
    busy: false,
    charging: false,
    batteryLevel: 0.8,
    lowPowerMode: false,
  };
  expect(shouldDescribeNow(base)).toBe(true);
  expect(shouldDescribeNow({ ...base, llmLoaded: false })).toBe(false);
  expect(shouldDescribeNow({ ...base, busy: true })).toBe(false);
  expect(shouldDescribeNow({ ...base, batteryLevel: 0.3 })).toBe(false);
  expect(shouldDescribeNow({ ...base, batteryLevel: 0.3, charging: true })).toBe(true);
  expect(shouldDescribeNow({ ...base, charging: true, lowPowerMode: true })).toBe(false);
});

test('capture text includes the voice note', () => {
  expect(captureText(null)).toBe('Captured photo.');
  expect(captureText(' buy this one ')).toBe('Captured photo. Voice note: buy this one');
});

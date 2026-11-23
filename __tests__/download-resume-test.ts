import { afterSystemDownload } from '@/engine/downloads';

jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));

test('a finished system download goes straight to the checksum', () => {
  expect(afterSystemDownload('done', 0)).toBe('verify');
});

test('a failed one is resumed a few times, then reported', () => {
  expect(afterSystemDownload('failed', 0)).toBe('resume');
  expect(afterSystemDownload('failed', 2)).toBe('resume');
  expect(afterSystemDownload('failed', 3)).toBe('fail');
});

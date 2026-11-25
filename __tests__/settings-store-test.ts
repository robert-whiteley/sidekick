import { getSettings, resetSettingsCache, updateSettings } from '@/engine/settings';

const mockStore: Record<string, string> = {};
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    kvGet: (k: string) => mockStore[k] ?? null,
    kvSet: (k: string, v: string) => {
      mockStore[k] = v;
    },
  },
}));

test('off the record is never saved', () => {
  updateSettings({ offTheRecord: true, fps: 1 });
  expect(getSettings().offTheRecord).toBe(true);
  expect(JSON.parse(mockStore['settings.v1'])).not.toHaveProperty('offTheRecord');
  resetSettingsCache();
  expect(getSettings().offTheRecord).toBe(false);
  expect(getSettings().fps).toBe(1);
});

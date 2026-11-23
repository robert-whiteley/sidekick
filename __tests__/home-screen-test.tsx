import { render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/index';

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));

jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    getDeviceInfo: () => ({
      manufacturer: 'Google',
      model: 'Pixel 5',
      soc: 'Qualcomm SM7250',
      totalRamMb: 7600,
      filesDir: '/data',
      externalFilesDir: '/ext',
    }),
    fileExists: () => false,
  },
}));

test('first run asks to download the model', async () => {
  await render(<HomeScreen />);
  expect(screen.getByText('One-time setup')).toBeTruthy();
  expect(screen.getByText(/3\.5 GB/)).toBeTruthy();
});

import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import HomeScreen from '@/app/index';

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('expo-network', () => ({
  addNetworkStateListener: () => ({ remove: jest.fn() }),
  getNetworkStateAsync: async () => ({ isConnected: true, type: 'WIFI' }),
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR' },
}));

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

test('first run downloads the model by itself', async () => {
  Platform.OS = 'android';
  await render(<HomeScreen />);
  expect(screen.getByText('Getting Sidekick ready')).toBeTruthy();
  expect(screen.getByText(/3\.5 GB/)).toBeTruthy();
});

test('the iPhone downloads less: speech and photo text are built into iOS', async () => {
  Platform.OS = 'ios';
  await render(<HomeScreen />);
  expect(screen.getByText(/3\.0 GB/)).toBeTruthy();
});

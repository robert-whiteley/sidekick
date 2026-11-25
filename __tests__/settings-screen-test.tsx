import { fireEvent, render, screen } from '@testing-library/react-native';

import MemoryScreen from '@/app/memory';
import SettingsScreen from '@/app/settings';
import AssistantSettings from '@/app/settings/assistant';
import CameraAudioSettings from '@/app/settings/camera';
import ConnectionsSettings from '@/app/settings/connections';
import PhoneFeatures from '@/app/settings/features';
import PrivacySettings from '@/app/settings/privacy';

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
// Rendered outside a navigator: run focus effects like plain effects.
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('expo-router'),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    useLocalSearchParams: () => ({}),
    Stack: { Screen: () => null },
  };
});
jest.mock('@/memory/store', () => ({
  listSpeakers: async () => [{ id: 1, name: null, isOwner: true, consented: false, moments: 3 }],
  savedFacts: async () => [{ id: 1, text: 'my locker is 42', status: 'saved' }],
  recentMoments: async () => [],
  applyRetention: async () => {},
}));
jest.mock('@/engine/followup-notify', () => ({
  addToCalendar: jest.fn(),
  allowExactReminders: async () => true,
  askNotificationPermission: async () => true,
  exactRemindersAllowed: async () => true,
  syncFollowupNotifications: async () => {},
}));
jest.mock('@/memory/followups', () => ({
  listFollowups: async () => [
    {
      id: 1,
      kind: 'todo',
      title: 'Buy milk',
      dueAt: null,
      allDay: false,
      whenText: '',
      status: 'suggested',
      createdAt: 0,
      sourceMomentId: null,
    },
  ],
  onFollowupsChange: () => () => {},
  updateFollowup: jest.fn(),
  dismissFollowup: jest.fn(),
  deleteFollowup: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  Paths: { totalDiskSpace: 128 * 1024 ** 3, availableDiskSpace: 60 * 1024 ** 3 },
}));
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    kvGet: () => null,
    kvSet: () => {},
    readBase64: () => null,
    listenConfigure: () => {},
    countryCode: () => 'GB',
    getDeviceInfo: () => ({
      manufacturer: 'Google',
      model: 'Pixel 5',
      soc: 'QTI SM7250',
      totalRamMb: 7600,
      filesDir: '/data',
      externalFilesDir: null,
    }),
  },
}));

test('settings home lists the sections', async () => {
  await render(<SettingsScreen />);
  for (const t of ['Assistant', 'Camera & audio', 'Connections', 'Privacy', 'Phone features']) {
    expect(screen.getByText(t)).toBeTruthy();
  }
});

test('assistant page shows voice with its Recommended value and follow-up settings', async () => {
  await render(<AssistantSettings />);
  expect(screen.getByText('Natural voice (Recommended)')).toBeTruthy();
  expect(screen.getByText('Routines')).toBeTruthy();
  expect(screen.getByText('Wake word')).toBeTruthy();
});

test('camera page marks Recommended values for this phone', async () => {
  await render(<CameraAudioSettings />);
  expect(screen.getByText('0.5 (Recommended)')).toBeTruthy(); // Pixel 5: slower chip
  expect(screen.getByText('3 days (Recommended)')).toBeTruthy();
});

test('privacy page has consent and delete', async () => {
  await render(<PrivacySettings />);
  expect(screen.getByText('Consent mode')).toBeTruthy();
  expect(screen.getByText('Delete everything')).toBeTruthy();
});

test('connections and phone features list everything', async () => {
  await render(<ConnectionsSettings />);
  expect(screen.getByText('Email (Gmail)')).toBeTruthy();
  await render(<PhoneFeatures />);
  expect(screen.getByText(/Send texts directly/)).toBeTruthy();
});

test('memory shows facts and to-dos', async () => {
  await render(<MemoryScreen />);
  expect(await screen.findByText('my locker is 42')).toBeTruthy();
  await fireEvent.press(screen.getByText('To-dos'));
  expect(await screen.findByText('To-do: Buy milk')).toBeTruthy();
});

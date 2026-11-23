import { render, screen } from '@testing-library/react-native';

import SettingsScreen from '@/app/settings';

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
// Rendered outside a navigator: run focus effects like plain effects.
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('expo-router'),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
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
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    kvGet: () => null,
    kvSet: () => {},
    readBase64: () => null,
    listenConfigure: () => {},
    countryCode: () => 'GB',
  },
}));

test('settings shows sections and loaded memory', async () => {
  await render(<SettingsScreen />);
  expect(screen.getByText('Listening')).toBeTruthy();
  expect(screen.getByText('Consent mode')).toBeTruthy();
  expect(await screen.findByText('You')).toBeTruthy();
  expect(await screen.findByText('my locker is 42')).toBeTruthy();
  expect(screen.getByText('Delete everything')).toBeTruthy();
  expect(await screen.findByText('To-do: Buy milk')).toBeTruthy();
  expect(screen.getByText('Daily summary')).toBeTruthy();
});

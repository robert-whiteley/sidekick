import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { notices } from '@/engine/notices';
import { AskScreen } from '@/features/ask/AskScreen';

const mockAnswer = jest.fn();

jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false }, jest.fn(async () => ({ granted: false }))],
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/features/ask/chat-history', () => ({
  loadChatHistory: async () => [
    { id: 'h1q', role: 'user', text: 'where did I park?', at: 1 },
    { id: 'h1a', role: 'assistant', text: 'Level 2, by the lift.', at: 1 },
  ],
}));
jest.mock('@/engine/assistant', () => ({
  DEFAULT_PHOTO_QUESTION: 'What am I looking at?',
  answer: (...a: unknown[]) => mockAnswer(...a),
  leaveOffTheRecord: jest.fn(),
}));
jest.mock('@/engine/llm', () => ({
  ensureLlm: async () => ({ backend: 'cpu' }),
  cancelLlm: jest.fn(),
  holdBackground: jest.fn(),
  releaseBackground: jest.fn(),
}));
jest.mock('@/engine/describe-photos', () => ({
  describeOnePhoto: jest.fn(),
  yieldToQuestion: async () => {},
}));
jest.mock('@/engine/fact-inference', () => ({
  inferFactsIfIdle: async () => {},
  stopFactInference: async () => {},
}));
jest.mock('@/engine/followup-inference', () => ({
  inferFollowupsIfIdle: async () => {},
  stopFollowupInference: async () => {},
}));
jest.mock('@/engine/name-inference', () => ({
  inferNamesIfIdle: async () => {},
  stopNameInference: async () => {},
}));
jest.mock('@/engine/followup-notify', () => ({ startFollowupNotifications: jest.fn() }));
jest.mock('@/engine/listen', () => ({
  configureListening: jest.fn(),
  isListening: () => false,
  askMicPermission: async () => true,
  startListening: async () => null,
  stopListening: jest.fn(),
  resumeListening: jest.fn(async () => false),
}));
jest.mock('@/engine/speaker', () => ({
  StreamingSpeaker: class {
    update() {}
    finish() {}
    stop() {}
  },
}));
jest.mock('@/memory/embed-idle', () => ({ embedWhenIdle: async () => {} }));
jest.mock('@/memory/sources', () => ({ syncSourcesIfDue: async () => {} }));
jest.mock('@/memory/store', () => ({
  capturePhoto: jest.fn(),
  ingestJournal: async () => 0,
  learnOwnerVoice: async () => {},
  syncOwnerVoice: async () => {},
}));
jest.mock('@/features/ask/LiveConversation', () => ({ LiveConversation: () => null }));
jest.mock('@/features/ask/WebLookupUi', () => ({
  OnlineBadge: () => null,
  WebSources: () => null,
  WebSearchLink: () => null,
}));
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: {
    addListener: () => ({ remove: () => {} }),
    kvGet: () => null,
    kvSet: () => {},
  },
}));

beforeEach(() => {
  mockAnswer.mockReset();
  mockAnswer.mockImplementation(async (_q: string, _p: unknown, onText: (t: string) => void) => {
    onText('A red car.');
    return { text: 'A red car.', usedPhoto: null, sources: [], ms: 1, ttftMs: 1 };
  });
});

test('a ChatGPT-simple chat: no app name or status, history shown, mic until you type', async () => {
  await render(<AskScreen />);
  expect(await screen.findByText('Level 2, by the lift.')).toBeTruthy();
  expect(screen.queryByText('Sidekick')).toBeNull();
  expect(screen.queryByText(/Ready/)).toBeNull();
  expect(screen.queryByText('Speak')).toBeNull();
  expect(screen.getByPlaceholderText('Ask Sidekick')).toBeTruthy();
  expect(screen.getByLabelText('Talk')).toBeTruthy();
  expect(screen.queryByLabelText('Send')).toBeNull();
  await fireEvent.changeText(screen.getByPlaceholderText('Ask Sidekick'), 'what car?');
  expect(screen.getByLabelText('Send')).toBeTruthy();
});

test('sending adds the question and the answer to the chat', async () => {
  await render(<AskScreen />);
  await screen.findByText('Level 2, by the lift.');
  await fireEvent.changeText(screen.getByPlaceholderText('Ask Sidekick'), 'what car?');
  await fireEvent.press(screen.getByLabelText('Send'));
  expect(await screen.findByText('A red car.')).toBeTruthy();
  expect(screen.getByText('what car?')).toBeTruthy();
  expect(mockAnswer.mock.calls[0][3]).toMatchObject({ offTheRecord: false });
});

test('long-press send goes Off the record; leaving it removes that chat', async () => {
  await render(<AskScreen />);
  await screen.findByText('Level 2, by the lift.');
  await fireEvent.changeText(screen.getByPlaceholderText('Ask Sidekick'), 'secret?');
  await fireEvent(screen.getByLabelText('Send'), 'longPress');
  expect(await screen.findByText('A red car.')).toBeTruthy();
  expect(mockAnswer.mock.calls[0][3]).toMatchObject({ offTheRecord: true });
  expect(screen.getByText(/this chat won.t be saved/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Off the record. Tap to leave.'));
  expect(screen.queryByText('secret?')).toBeNull();
  expect(screen.getByText('Level 2, by the lift.')).toBeTruthy();
});

test('notices: info is a faint line, a decision is a card with buttons', async () => {
  await render(<AskScreen />);
  const onAction = jest.fn();
  await act(async () => {
    notices.post({ key: 'fps', kind: 'info', text: 'Frame rate lowered: phone is hot' });
    notices.post(
      {
        key: 'storage',
        kind: 'decision',
        text: 'Storage runs out in 3 days',
        actions: [{ label: 'Keep video 7 days', id: 'keep7' }],
      },
      onAction,
    );
  });
  expect(screen.getByText('Frame rate lowered: phone is hot')).toBeTruthy();
  await fireEvent.press(screen.getByText('Keep video 7 days'));
  expect(onAction).toHaveBeenCalledWith('keep7');
  expect(screen.queryByText('Storage runs out in 3 days')).toBeNull();
  await act(async () => notices.dismiss('fps'));
});

test('opening the chat turns listening back on if it was on before the app was killed', async () => {
  const { resumeListening } = jest.requireMock('@/engine/listen');
  resumeListening.mockClear();
  await render(<AskScreen />);
  expect(resumeListening).toHaveBeenCalledTimes(1);
});

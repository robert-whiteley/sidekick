import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { notices } from '@/engine/notices';
import { AskScreen } from '@/features/ask/AskScreen';

const mockAnswer = jest.fn();
const mockStop = jest.fn();

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
  stopAnswer: () => mockStop(),
  answerOver: jest.fn(),
  holdBackground: jest.fn(),
  releaseBackground: jest.fn(),
}));
jest.mock('@/engine/describe-photos', () => ({
  describeOnePhoto: jest.fn(async () => false),
  captionOneFrame: jest.fn(async () => false),
  noteUserActive: jest.fn(),
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
const mockListening = { on: false };
jest.mock('@/engine/listen', () => ({
  configureListening: jest.fn(),
  isListening: () => mockListening.on,
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
jest.mock('@/memory/gallery', () => ({
  indexPhotosWhenIdle: async () => 0,
  openOriginal: () => false,
}));
jest.mock('@/memory/store', () => ({
  capturePhoto: jest.fn(),
  ingestJournal: async () => 0,
  learnOwnerVoice: async () => {},
  syncOwnerVoice: async () => {},
  forgetUnagreedVoices: async () => 0,
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

test('the Listen button follows the real microphone when it is stopped from the notification', async () => {
  jest.useFakeTimers();
  Platform.OS = 'android';
  try {
    mockListening.on = true;
    await render(<AskScreen />);
    expect(await screen.findByText('Level 2, by the lift.')).toBeTruthy();
    const on = () =>
      screen.getByLabelText('Listen in the background').props.accessibilityState?.checked;
    expect(on()).toBe(true);
    mockListening.on = false; // Stop pressed in the notification
    await act(async () => {
      jest.advanceTimersByTime(3500);
    });
    expect(on()).toBe(false);
  } finally {
    mockListening.on = false;
    Platform.OS = 'ios';
    jest.useRealTimers();
  }
});

test('the iPhone has no background Listen button (hold the mic instead)', async () => {
  await render(<AskScreen />);
  expect(await screen.findByText('Level 2, by the lift.')).toBeTruthy();
  expect(screen.queryByLabelText('Listen in the background')).toBeNull();
});

test('typed while answering: queued in order, then each answered in turn', async () => {
  const finish: (() => void)[] = [];
  mockAnswer.mockImplementation(
    (q: string, _p: unknown, onText: (t: string) => void) =>
      new Promise((resolve) => {
        onText(`Writing about ${q}`);
        finish.push(() =>
          resolve({ text: `About ${q}.`, usedPhoto: null, sources: [], ms: 1, ttftMs: 1 }),
        );
      }),
  );
  await render(<AskScreen />);
  await screen.findByText('Level 2, by the lift.');
  const box = screen.getByPlaceholderText('Ask Sidekick');
  await fireEvent.changeText(box, 'one');
  await fireEvent.press(screen.getByLabelText('Send'));
  expect(await screen.findByText('Writing about one')).toBeTruthy();
  expect(screen.getByLabelText('Stop')).toBeTruthy();
  await fireEvent.changeText(box, 'two');
  await fireEvent.press(screen.getByLabelText('Send'));
  await fireEvent.changeText(box, 'three');
  await fireEvent.press(screen.getByLabelText('Send'));
  expect(screen.getByText('Next')).toBeTruthy();
  expect(screen.getByText('Queued')).toBeTruthy();
  // Removed before it starts: never asked.
  await fireEvent.press(screen.getAllByText('Remove')[1]);
  expect(screen.queryByText('three')).toBeNull();
  expect(mockAnswer).toHaveBeenCalledTimes(1);
  await act(async () => finish.shift()!());
  expect(await screen.findByText('Writing about two')).toBeTruthy();
  expect(screen.getByText('About one.')).toBeTruthy();
  expect(mockAnswer).toHaveBeenCalledTimes(2);
  await act(async () => finish.shift()!());
  expect(await screen.findByText('About two.')).toBeTruthy();
  expect(mockAnswer.mock.calls.map((c) => c[0])).toEqual(['one', 'two']);
});

test('Send now stops the answer (kept, marked stopped); an unanswered one is asked with it', async () => {
  mockStop.mockReset();
  const pending: ((text: string) => void)[] = [];
  mockAnswer.mockImplementation(
    (_q: string) =>
      new Promise((resolve) =>
        pending.push((text) => resolve({ text, usedPhoto: null, sources: [], ms: 1, ttftMs: 1 })),
      ),
  );
  await render(<AskScreen />);
  await screen.findByText('Level 2, by the lift.');
  const box = screen.getByPlaceholderText('Ask Sidekick');
  await fireEvent.changeText(box, 'weather?');
  await fireEvent.press(screen.getByLabelText('Send'));
  await fireEvent.changeText(box, 'and tomorrow?');
  await fireEvent.press(screen.getByLabelText('Send'));
  await fireEvent.press(screen.getByText('Send now'));
  expect(mockStop).toHaveBeenCalledTimes(1);
  // Stopped before any words: nothing written.
  await act(async () => pending.shift()!(''));
  expect(await screen.findByText('Stopped')).toBeTruthy();
  expect(mockAnswer.mock.calls[1][0]).toBe('weather?\n\nand tomorrow?');
  await act(async () => pending.shift()!('Sunny today and tomorrow.'));
  expect(await screen.findByText('Sunny today and tomorrow.')).toBeTruthy();
  expect(screen.getByText('weather?')).toBeTruthy();
  expect(screen.getByText('and tomorrow?')).toBeTruthy();
});

test('long-press send while answering sends now; idle it still goes Off the record', async () => {
  mockStop.mockReset();
  const pending: ((text: string) => void)[] = [];
  mockAnswer.mockImplementation(
    (_q: string, _p: unknown, onText: (t: string) => void) =>
      new Promise((resolve) => {
        onText('Part of it');
        pending.push((text) => resolve({ text, usedPhoto: null, sources: [], ms: 1, ttftMs: 1 }));
      }),
  );
  await render(<AskScreen />);
  await screen.findByText('Level 2, by the lift.');
  const box = screen.getByPlaceholderText('Ask Sidekick');
  await fireEvent.changeText(box, 'long story?');
  await fireEvent.press(screen.getByLabelText('Send'));
  await fireEvent.changeText(box, 'short one');
  await fireEvent(screen.getByLabelText('Send'), 'longPress');
  expect(mockStop).toHaveBeenCalledTimes(1);
  await act(async () => pending.shift()!('Part of it'));
  expect(await screen.findByText('Stopped')).toBeTruthy();
  // Something was written: the new message is asked alone (the model has the part-answer).
  expect(mockAnswer.mock.calls[1][0]).toBe('short one');
  expect(mockAnswer.mock.calls[1][3]).toMatchObject({ offTheRecord: false });
  await act(async () => pending.shift()!('Done.'));
});

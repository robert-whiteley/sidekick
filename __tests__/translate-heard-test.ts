import { liveTranscript } from '@/engine/live-transcript';
import { TRANSLATION_MARK } from '@/engine/language-logic';
import { translateHeardIfIdle } from '@/engine/translate-heard';

const mockStore = {
  linesToCheck: jest.fn((..._a: unknown[]) =>
    Promise.resolve([] as { id: number; at: number; text: string }[]),
  ),
  markEnglish: jest.fn(async (_ids: number[]) => {}),
  saveTranslation: jest.fn(async (_id: number, _lang: string, _text: string) => {}),
};
jest.mock('@/memory/translations', () => ({
  linesToCheck: (...a: unknown[]) => mockStore.linesToCheck(...a),
  markEnglish: (ids: number[]) => mockStore.markEnglish(ids),
  saveTranslation: (id: number, lang: string, text: string) =>
    mockStore.saveTranslation(id, lang, text),
}));
jest.mock('../modules/sidekick-native', () => ({
  __esModule: true,
  default: { llmIsLoaded: () => true },
}));
const mockSettings = { understandOtherLanguages: true };
jest.mock('@/engine/settings', () => ({ getSettings: () => mockSettings }));
const mockLlm = {
  askLlmInBackground: jest.fn((..._a: unknown[]) => Promise.resolve({ text: '' })),
  cancelLlm: jest.fn(),
};
jest.mock('@/engine/llm', () => ({
  askLlmInBackground: (...a: unknown[]) => mockLlm.askLlmInBackground(...a),
  cancelLlm: () => mockLlm.cancelLlm(),
}));

beforeEach(() => jest.clearAllMocks());

test('translates foreign lines, marks English ones, updates the live line', async () => {
  liveTranscript.put({
    at: 2,
    text: 'Ich habe heute keine Zeit, aber wir können morgen gehen.',
    speakerId: 3,
    isOwner: false,
    saved: true,
  });
  mockStore.linesToCheck.mockResolvedValueOnce([
    { id: 2, at: 2, text: 'Ich habe heute keine Zeit, aber wir können morgen gehen.' },
    { id: 1, at: 1, text: 'Can we get the bill?' },
  ]);
  mockStore.linesToCheck.mockResolvedValue([]);
  mockLlm.askLlmInBackground.mockResolvedValue({ text: "1. I don't have time." });
  await translateHeardIfIdle();
  expect(mockStore.markEnglish).toHaveBeenCalledWith([1]);
  expect(mockStore.saveTranslation).toHaveBeenCalledWith(
    2,
    'de',
    `Ich habe heute keine Zeit, aber wir können morgen gehen.${TRANSLATION_MARK}I don't have time.`,
  );
  expect(liveTranscript.all.find((l) => l.at === 2)?.text).toContain("I don't have time.");
});

test('does nothing while the setting is off', async () => {
  mockSettings.understandOtherLanguages = false;
  await translateHeardIfIdle();
  expect(mockStore.linesToCheck).not.toHaveBeenCalled();
  mockSettings.understandOtherLanguages = true;
});

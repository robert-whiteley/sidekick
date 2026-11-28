/**
 * A long shared text is read part by part (shared-doc.ts answerFromText); the model is mocked.
 */
import { answerFromText } from '@/engine/shared-doc';
import { DOC_LIMITS, DOC_NOTHING_FOUND } from '@/engine/shared-doc-logic';

const mockAsk = jest.fn();
jest.mock('@/engine/llm', () => ({
  askLlm: (...a: unknown[]) => mockAsk(...a),
  answerStopped: () => false,
}));
jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: {} }));
jest.mock('@/integrations/native', () => ({ integrationsNative: () => null }));
jest.mock('@/memory/store', () => ({}));
jest.mock('@/memory/sources', () => ({}));
jest.mock('@/memory/photo-text', () => ({}));
jest.mock('@/files/device', () => ({}));
jest.mock('@/web/lookup', () => ({}));
jest.mock('@/web/page', () => ({}));
jest.mock('./../src/engine/online-queue', () => ({}));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-sharing', () => ({}));

const long = 'The quick brown fox counts sheep. '.repeat(
  Math.ceil((DOC_LIMITS.singleChars * 2) / 34),
);

beforeEach(() => mockAsk.mockReset());

it('no part has anything on the question: says so, not a bare NONE from the model', async () => {
  mockAsk.mockResolvedValue({ text: 'NONE' });
  const r = await answerFromText(
    'the document "big.txt"',
    long,
    'What is the secret word?',
    () => {},
  );
  expect(r.text).toBe(DOC_NOTHING_FOUND);
  // Only the parts were read: no answer pass with nothing to answer from.
  expect(mockAsk.mock.calls.every(([p]) => String(p).startsWith('Part '))).toBe(true);
});

it('a part with notes: the answer is written from them', async () => {
  mockAsk.mockImplementation(async (p: string) => ({
    text: p.startsWith('Notes taken')
      ? 'It is marmalade.'
      : p.startsWith('Part 2')
        ? 'marmalade'
        : 'NONE',
  }));
  const r = await answerFromText(
    'the document "big.txt"',
    long,
    'What is the secret word?',
    () => {},
  );
  expect(r.text).toBe('It is marmalade.');
});

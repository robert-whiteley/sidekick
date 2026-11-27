const mockNative = {
  llmIsLoaded: jest.fn(() => true),
  llmCancel: jest.fn(),
  llmGenerate: jest.fn(async () => ({
    ttftMs: 1,
    prefillTokens: 1,
    prefillTokensPerSec: 1,
    decodeTokens: 1,
    decodeTokensPerSec: 1,
    totalMs: 1,
  })),
  addListener: jest.fn(() => ({ remove: () => {} })),
  getDeviceInfo: () => ({ soc: '', totalRamMb: 8000 }),
  kvGet: () => 'cpu',
  kvSet: () => {},
  fileExists: () => true,
  llmLoad: jest.fn(async () => ({ backend: 'cpu' })),
  llmPrepare: jest.fn(async () => {}),
};
jest.mock('../modules/sidekick-native', () => ({ __esModule: true, default: mockNative }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const llm = require('@/engine/llm') as typeof import('@/engine/llm');

test('after Stop, the answer’s later model steps get nothing and no action can follow', async () => {
  await llm.ensureLlm();
  llm.stopAnswer();
  expect(mockNative.llmCancel).toHaveBeenCalled();
  expect(llm.answerStopped()).toBe(true);
  mockNative.llmGenerate.mockClear();
  const r = await llm.askLlm('which tool?', null, () => {});
  expect(r.text).toBe('');
  expect(mockNative.llmGenerate).not.toHaveBeenCalled();
  // Background passes are not the answer's: they still run.
  await llm.askLlm('facts', null, () => {}, undefined, true);
  expect(mockNative.llmGenerate).toHaveBeenCalledTimes(1);
  llm.answerOver();
  expect(llm.answerStopped()).toBe(false);
  await llm.askLlm('next question', null, () => {});
  expect(mockNative.llmGenerate).toHaveBeenCalledTimes(2);
});

test('Stop while it writes keeps what was written, though the model ends with an error', async () => {
  await llm.ensureLlm();
  let send: (e: { requestId: string; text: string }) => void = () => {};
  mockNative.addListener.mockImplementationOnce(((_: string, f: typeof send) => {
    send = f;
    return { remove: () => {} };
  }) as never);
  mockNative.llmGenerate.mockImplementationOnce((async (id: string) => {
    send({ requestId: id, text: 'Water thoroughly when' });
    llm.stopAnswer();
    throw new Error('Task cancelled');
  }) as never);
  const r = await llm.askLlm('five tips', null, () => {});
  expect(r.text).toBe('Water thoroughly when');
  llm.answerOver();
  // Not stopped: a failure is still a failure.
  mockNative.llmGenerate.mockImplementationOnce((async () => {
    throw new Error('Task cancelled');
  }) as never);
  await expect(llm.askLlm('next', null, () => {})).rejects.toThrow('Task cancelled');
});

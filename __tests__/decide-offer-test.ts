/**
 * What the sorter is offered follows app state (decide.ts): edit_photo only with a photo, draft
 * only while one waits; research always.
 */
import { decideRequest } from '@/engine/decide';

const mockAsk = jest.fn(async (..._a: unknown[]) => ({ text: 'answer' }));
jest.mock('@/engine/llm', () => ({ askLlm: (...a: unknown[]) => mockAsk(...a) }));

const systemFor = async (opts: { draftOpen?: boolean; photo?: boolean }) => {
  mockAsk.mockClear();
  await decideRequest('make the background white', opts);
  return (mockAsk.mock.calls[0][3] as { system: string }).system;
};

test('edit_photo only with a photo, draft only with a draft, research always', async () => {
  const plain = await systemFor({});
  expect(plain).not.toMatch(/^edit_photo: /m);
  expect(plain).not.toMatch(/^draft: /m);
  expect(plain).toMatch(/^research: /m);
  expect(await systemFor({ photo: true })).toMatch(/^edit_photo: /m);
  expect(await systemFor({ draftOpen: true })).toMatch(/^draft: /m);
});

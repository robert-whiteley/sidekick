/**
 * What the sorter is offered follows app state (decide.ts): edit_photo (with erase and upscale)
 * only with a photo, draft only while one waits; research and make_picture always (make_picture's
 * answer says when the picture model is missing or the phone can't draw).
 */
import { decideRequest } from '@/engine/decide';

const mockAsk = jest.fn(async (..._a: unknown[]) => ({ text: 'answer' }));
jest.mock('@/engine/llm', () => ({ askLlm: (...a: unknown[]) => mockAsk(...a) }));

const systemFor = async (opts: { draftOpen?: boolean; photo?: boolean; file?: boolean }) => {
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

test('make_picture is always offered, so a drawing request never becomes a web search', async () => {
  expect(await systemFor({})).toMatch(/^make_picture: /m);
  expect(await systemFor({ photo: true })).toMatch(/^make_picture: /m);
});

test('erase and upscale come only with a photo (as edit_photo ops)', async () => {
  expect(await systemFor({})).not.toMatch(/erase|upscale/);
  const withPhoto = await systemFor({ photo: true });
  expect(withPhoto).toMatch(/^edit_photo: .*erase .*upscale/m);
});

test('the sorter is told when a photo comes with the request (from app state, not the words)', async () => {
  mockAsk.mockClear();
  await decideRequest('What is this?', { photo: true });
  expect(mockAsk.mock.calls[0][0]).toBe('Request (with a photo): What is this?');
  expect((mockAsk.mock.calls[0][3] as { system: string }).system).toMatch(
    /questions about a photo or file that comes with the request/,
  );
  mockAsk.mockClear();
  await decideRequest('What is this?');
  expect(mockAsk.mock.calls[0][0]).toBe('Request: What is this?');
});

test('the sorter is told when a file is attached, so a setting request is still a tool', async () => {
  mockAsk.mockClear();
  await decideRequest('turn off spoken answers', { file: true });
  expect(mockAsk.mock.calls[0][0]).toBe('Request (with a file attached): turn off spoken answers');
  expect((mockAsk.mock.calls[0][3] as { system: string }).system).toMatch(/^app_setting: /m);
});

test('with a file attached, the phone search is not offered: the question is about that file', async () => {
  expect(await systemFor({})).toMatch(/^find_on_phone: /m);
  const withFile = await systemFor({ file: true });
  expect(withFile).not.toMatch(/^find_on_phone: /m);
  expect(withFile).toMatch(/^app_setting: /m);
});

// The emulator flows: "What is in this file?" and CSV, slides and ZIP questions went to scan, an
// Excel total to calculate.
test('with a file attached, tools reading the camera, the phone or a typed sum are not offered', async () => {
  const withFile = await systemFor({ file: true });
  for (const t of ['scan', 'camera', 'watch', 'calculate', 'convert', 'clipboard', 'recap'])
    expect(withFile).not.toMatch(new RegExp(`^${t}: `, 'm'));
  for (const t of ['app_setting', 'message', 'alarm', 'timer', 'translate'])
    expect(withFile).toMatch(new RegExp(`^${t}: `, 'm'));
  const plain = await systemFor({});
  expect(plain).toMatch(/^scan: /m);
  expect(plain).toMatch(/^calculate: /m);
});

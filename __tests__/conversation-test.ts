import { Conversation, FOLLOW_UP_MS } from '../src/engine/conversation';

test('the first question always starts a fresh chat', () => {
  const c = new Conversation();
  expect(c.keepHistory(true, 0)).toBe(false);
});

test('a reply heard as a follow-up keeps the chat', () => {
  const c = new Conversation();
  c.answered(1000);
  expect(c.keepHistory(true, 60_000)).toBe(true);
});

test('a typed or held question keeps the chat only inside the follow-up window', () => {
  const c = new Conversation();
  c.answered(1000);
  expect(c.keepHistory(false, 1000 + FOLLOW_UP_MS)).toBe(true);
  expect(c.keepHistory(false, 1001 + FOLLOW_UP_MS)).toBe(false);
});

test('reset starts over', () => {
  const c = new Conversation();
  c.answered(1000);
  c.reset();
  expect(c.keepHistory(false, 1001)).toBe(false);
});

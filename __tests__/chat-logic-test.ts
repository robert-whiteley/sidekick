import {
  exchangeToMessages,
  historyToMessages,
  isMicTap,
  mediaForAnswer,
  partialStatus,
  NOT_HEARD_AFTER_BARGE,
  patchMessage,
  quietAfterBargeIn,
  shouldSpeak,
  withoutOffRecord,
  type ChatMessage,
} from '@/features/ask/chat-logic';

test('a saved exchange becomes a question and an answer bubble', () => {
  const [q, a] = exchangeToMessages({
    id: 3,
    at: 10,
    text: 'Q: where are my keys?\nA: On the desk.\nBy the lamp.',
  });
  expect(q).toMatchObject({ role: 'user', text: 'where are my keys?', at: 10 });
  expect(a).toMatchObject({ role: 'assistant', text: 'On the desk.\nBy the lamp.' });
});

test('photo exchanges carry their photo; other rows are skipped', () => {
  const [q] = exchangeToMessages({
    id: 1,
    at: 5,
    text: 'Q: what is this?\nA: A mug.',
    photoPath: '/p/5.jpg',
  });
  expect(q.media).toEqual([{ momentAt: 5, kind: 'photo', path: '/p/5.jpg' }]);
  expect(exchangeToMessages({ id: 2, at: 6, text: 'just speech' })).toEqual([]);
});

test('history reads oldest first', () => {
  const msgs = historyToMessages([
    { id: 2, at: 200, text: 'Q: second\nA: 2' },
    { id: 1, at: 100, text: 'Q: first\nA: 1' },
  ]);
  expect(msgs.map((m) => m.text)).toEqual(['first', '1', 'second', '2']);
});

test('voice in, voice out; headphones always speak; off means never', () => {
  expect(shouldSpeak({ spoken: true, headphones: false, enabled: true })).toBe(true);
  expect(shouldSpeak({ spoken: false, headphones: false, enabled: true })).toBe(false);
  expect(shouldSpeak({ spoken: false, headphones: true, enabled: true })).toBe(true);
  expect(shouldSpeak({ spoken: true, headphones: true, enabled: false })).toBe(false);
});

test('a short mic press is a tap, a long one is hold-to-talk', () => {
  expect(isMicTap(1000, 1200)).toBe(true);
  expect(isMicTap(1000, 2000)).toBe(false);
});

test('an answer shows the saved photo it re-read, plus engine media, without duplicates', () => {
  const sources = [
    { at: 50, photoPath: '/p/50.jpg' },
    { at: 60, photoPath: null },
  ];
  expect(mediaForAnswer({ usedPhoto: '/p/50.jpg', sources })).toEqual([
    { momentAt: 50, kind: 'photo', path: '/p/50.jpg' },
  ]);
  expect(mediaForAnswer({ usedPhoto: null, sources })).toBeUndefined();
  const video = { momentAt: 70, kind: 'video' as const, path: '/v/1.mp4' };
  expect(mediaForAnswer({ usedPhoto: null, sources, media: [video] })).toEqual([video]);
  expect(
    mediaForAnswer({
      usedPhoto: '/p/50.jpg',
      sources,
      media: [{ momentAt: 50, kind: 'photo', path: '/p/50.jpg' }],
    }),
  ).toHaveLength(1);
});

test('leaving Off the record removes what was said in it', () => {
  const msgs: ChatMessage[] = [
    { id: 'a', role: 'user', text: 'kept', at: 1 },
    { id: 'b', role: 'user', text: 'secret', at: 2, offRecord: true },
  ];
  expect(withoutOffRecord(msgs).map((m) => m.id)).toEqual(['a']);
  expect(patchMessage(msgs, 'a', { text: 'edited' })[0].text).toBe('edited');
  expect(patchMessage(msgs, 'zz', { text: 'x' })).toEqual(msgs);
});

test('live words show while talking, trimmed to the last few', () => {
  expect(partialStatus('  ')).toBe('Listening…');
  expect(partialStatus('what time is it')).toBe('“what time is it…”');
  const long = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
  expect(partialStatus(long, 3)).toBe('“…w17 w18 w19…”');
});

describe('nothing heard after talking over an answer', () => {
  const q: ChatMessage = { id: 'u1', role: 'user', text: 'time in Tokyo?', at: 1 };
  it('fills the empty stopped answer with a plain line', () => {
    const empty: ChatMessage = { id: 'a1', role: 'assistant', text: '', at: 1, stopped: true };
    const out = quietAfterBargeIn([q, empty], 'a1', 5);
    expect(out).toHaveLength(2);
    expect(out[1].text).toBe(NOT_HEARD_AFTER_BARGE);
  });
  it('keeps a part-answer and adds the line after it', () => {
    const part: ChatMessage = { id: 'a1', role: 'assistant', text: 'It is', at: 1, stopped: true };
    const out = quietAfterBargeIn([q, part], 'a1', 5);
    expect(out[1].text).toBe('It is');
    expect(out[2]).toMatchObject({ role: 'assistant', text: NOT_HEARD_AFTER_BARGE });
  });
  it('with no answer to point at, still says it', () => {
    expect(quietAfterBargeIn([], null, 5).at(-1)?.text).toBe(NOT_HEARD_AFTER_BARGE);
  });
});

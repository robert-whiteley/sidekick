import { speechClipFor } from '@/engine/speech-clip';

const lines = [
  { at: 1, kind: 'answer', audioPath: null },
  { at: 2, kind: 'speech', audioPath: '/a/2.ogg' },
  { at: 3, kind: 'speech', audioPath: '/a/3.ogg' },
];

test('a question about something said gets the best heard line with audio', () => {
  expect(speechClipFor('What did Sam say about the rent?', lines)).toEqual([
    { momentAt: 2, kind: 'audio', path: '/a/2.ogg' },
  ]);
  expect(speechClipFor('Who mentioned the meeting', lines)?.[0].path).toBe('/a/2.ogg');
});

test('no clip for other questions, or when no line kept its audio', () => {
  expect(speechClipFor('What is the capital of France?', lines)).toBeUndefined();
  expect(
    speechClipFor('What did Sam say?', [{ at: 1, kind: 'speech', audioPath: null }]),
  ).toBeUndefined();
});

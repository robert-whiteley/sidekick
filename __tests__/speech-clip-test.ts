import { DECIDE_TOOLS, parseClassify } from '@/engine/decide-logic';
import { speechClipFor } from '@/engine/speech-clip';

const lines = [
  { at: 1, kind: 'answer', audioPath: null },
  { at: 2, kind: 'speech', audioPath: '/a/2.ogg' },
  { at: 3, kind: 'speech', audioPath: '/a/3.ogg' },
];

test('the best heard line with audio is the clip', () => {
  expect(speechClipFor(lines)).toEqual([{ momentAt: 2, kind: 'audio', path: '/a/2.ogg' }]);
});

test('no clip when no heard line kept its audio', () => {
  expect(speechClipFor([{ at: 1, kind: 'speech', audioPath: null }])).toBeUndefined();
  expect(speechClipFor([{ at: 1, kind: 'answer', audioPath: '/a/1.ogg' }])).toBeUndefined();
});

test('playing a recording is the model’s choice, from the tool list', () => {
  expect(DECIDE_TOOLS.some((t) => t.name === 'play_recording')).toBe(true);
  expect(parseClassify('play_recording')).toEqual({ kind: 'do', tool: 'play_recording' });
});

import { DECIDE_TOOLS, parseClassify } from '@/engine/decide-logic';
import {
  clipCandidates,
  parseUsedClip,
  speechClipFor,
  usedClipPrompt,
  usedSpeechClip,
} from '@/engine/speech-clip';

const lines = [
  { at: 1, kind: 'answer', text: 'Q: hi\nA: hello', audioPath: null },
  { at: 2, kind: 'speech', text: 'The bins go out on Tuesday now.', audioPath: '/a/2.ogg' },
  { at: 3, kind: 'speech', text: 'The meeting moved to Friday at ten.', audioPath: '/a/3.ogg' },
  { at: 4, kind: 'speech', text: 'No recording kept for this one.', audioPath: null },
];

test('play_recording: the best heard line with audio is the clip', () => {
  expect(speechClipFor(lines)).toEqual([{ momentAt: 2, kind: 'audio', path: '/a/2.ogg' }]);
  expect(speechClipFor([{ at: 1, kind: 'speech', audioPath: null }])).toBeUndefined();
  expect(speechClipFor([{ at: 1, kind: 'answer', audioPath: '/a/1.ogg' }])).toBeUndefined();
});

test('playing a recording is the model’s choice, from the tool list', () => {
  expect(DECIDE_TOOLS.some((t) => t.name === 'play_recording')).toBe(true);
  expect(parseClassify('play_recording')).toEqual({ kind: 'do', tool: 'play_recording' });
});

test('only heard lines with audio are offered to the check, numbered', () => {
  const c = clipCandidates(lines);
  expect(c.map((m) => m.at)).toEqual([2, 3]);
  const p = usedClipPrompt('What did Tom say about the meeting?', 'It moved to Friday.', c);
  expect(p).toContain('1. The bins go out on Tuesday now.');
  expect(p).toContain('2. The meeting moved to Friday at ten.');
  expect(p).toContain('Answer: It moved to Friday.');
});

test('the model’s number picks that line; 0, junk or out of range picks none', () => {
  const c = clipCandidates(lines);
  expect(parseUsedClip('2', c)?.at).toBe(3);
  expect(parseUsedClip(' 1.', c)?.at).toBe(2);
  expect(parseUsedClip('0', c)).toBeUndefined();
  expect(parseUsedClip('none', c)).toBeUndefined();
  expect(parseUsedClip('7', c)).toBeUndefined();
});

test('the clip shown is the line the answer used, not the best match', async () => {
  const ask = jest.fn(async () => '2');
  expect(await usedSpeechClip('What did Tom say?', 'Friday at ten.', lines, ask)).toEqual([
    { momentAt: 3, kind: 'audio', path: '/a/3.ogg' },
  ]);
  ask.mockResolvedValueOnce('0');
  expect(await usedSpeechClip('Tell me a joke', 'Why did…', lines, ask)).toBeUndefined();
});

test('no check at all when no heard line with audio was in the prompt', async () => {
  const ask = jest.fn(async () => '1');
  expect(await usedSpeechClip('q', 'a', [lines[0], lines[3]], ask)).toBeUndefined();
  expect(ask).not.toHaveBeenCalled();
});

test('a failed check shows nothing', async () => {
  const ask = jest.fn(async () => {
    throw new Error('busy');
  });
  expect(await usedSpeechClip('q', 'a', lines, ask)).toBeUndefined();
});

import { forSpeech, takeSentences } from '../src/engine/sentences';

test('complete sentences are released, the unfinished tail is kept', () => {
  expect(takeSentences('It is blue. Light scatt')).toEqual({
    done: ['It is blue.'],
    rest: ' Light scatt',
  });
});

test('a sentence at the very end waits (the stream may continue it)', () => {
  expect(takeSentences('Version 3.')).toEqual({ done: [], rest: 'Version 3.' });
  expect(takeSentences('Version 3.5 is out! Yes')).toEqual({
    done: ['Version 3.5 is out!'],
    rest: ' Yes',
  });
});

test('markdown is stripped for speech', () => {
  expect(forSpeech('**Platform 4** at `14:32` [map](http://x)')).toBe('Platform 4 at 14:32 map');
});

test('newlines end a sentence', () => {
  expect(takeSentences('One\nTwo')).toEqual({ done: ['One'], rest: 'Two' });
});

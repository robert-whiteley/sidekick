import { encodeWakePhrase, wakeKeywordLine } from '../src/engine/wake-word';

// Tiny unigram vocabulary (piece -> log score) shaped like the real model's.
const vocab = new Map<string, number>([
  ['▁', -3],
  ['▁HE', -5],
  ['Y', -6],
  ['SIDE', -9],
  ['K', -6],
  ['IC', -8],
  ['S', -6],
  ['I', -6],
  ['D', -6],
  ['E', -6],
  ['C', -6],
  ['H', -6],
]);

test('picks the highest-scoring split, like sentencepiece', () => {
  expect(encodeWakePhrase('Hey Sidekick', vocab)).toEqual([
    '▁HE',
    'Y',
    '▁',
    'SIDE',
    'K',
    'IC',
    'K',
  ]);
});

test('builds the keyword spotter line', () => {
  expect(wakeKeywordLine('hey sidekick', vocab)).toBe(
    '▁HE Y ▁ SIDE K IC K :2.0 #0.25 @HEY_SIDEKICK',
  );
});

test('refuses letters the model cannot spell', () => {
  expect(encodeWakePhrase('Hey Zed', vocab)).toBeNull();
});

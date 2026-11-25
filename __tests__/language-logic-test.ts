import {
  detectLanguage,
  parseTranslations,
  speechModelFor,
  splitTranslation,
  TRANSLATION_MARK,
  translationPrompt,
  withTranslation,
} from '@/engine/language-logic';
import { SYSTEM_PROMPT } from '@/engine/prompts';

test('English speech model unless other languages are wanted', () => {
  expect(speechModelFor(false)).toBe('parakeet-v2');
  expect(speechModelFor(true)).toBe('parakeet-v3');
});

test('Sidekick answers in English', () => {
  expect(SYSTEM_PROMPT).toContain('plain spoken English');
});

test.each([
  ['Can you bring us the bill, please? We are in a hurry.', 'en'],
  ['What time is it in Tokyo right now', 'en'],
  ['Ich habe heute keine Zeit, aber wir können morgen gehen.', 'de'],
  ['Je ne sais pas si le train est déjà parti.', 'fr'],
  ['¿Dónde está la estación? No lo sé, pero está muy cerca.', 'es'],
  ['Non è vero, questo è il mio posto.', 'it'],
  ['Não sei, mas você está muito atrasado.', 'pt'],
  ['Ik weet het niet, maar het is ook niet mijn probleem.', 'nl'],
  ['Nie wiem, czy to jest dobry pomysł.', 'pl'],
  ['Я не знаю, где это находится.', 'ru'],
  ['Я не знаю, де це знаходиться, і їх там немає.', 'uk'],
  ['Δεν ξέρω πού είναι ο σταθμός.', 'el'],
  ['Jag vet inte om det är för sent.', 'sv'],
])('detects %s as %s', (text, code) => {
  const d = detectLanguage(text);
  expect(d.code).toBe(code);
  if (code !== 'en') expect(d.confident).toBe(true);
});

test('short or unclear lines stay English (left alone)', () => {
  for (const t of ['ok', 'yes', 'Hmm.', 'Sam', 'pizza margherita', '']) {
    const d = detectLanguage(t);
    expect(d.code === 'en' || !d.confident).toBe(true);
  }
});

test('translation is kept with the original and can be split again', () => {
  const t = withTranslation('Wo ist der Bahnhof?', 'Where is the station?');
  expect(t).toBe(`Wo ist der Bahnhof?${TRANSLATION_MARK}Where is the station?`);
  expect(splitTranslation(t)).toEqual({
    original: 'Wo ist der Bahnhof?',
    english: 'Where is the station?',
  });
  // Translating again replaces, never stacks.
  expect(withTranslation(t, 'Where is the train station?')).toBe(
    `Wo ist der Bahnhof?${TRANSLATION_MARK}Where is the train station?`,
  );
  expect(splitTranslation('plain')).toEqual({ original: 'plain', english: null });
});

test('batch prompt and reply parsing', () => {
  const p = translationPrompt([
    { text: 'Bonjour', code: 'fr' },
    { text: 'Danke', code: 'de' },
  ]);
  expect(p).toContain('1. (French) Bonjour');
  expect(p).toContain('2. (German) Danke');
  expect(parseTranslations('1. Hello\n2) "Thanks"', 2)).toEqual(['Hello', 'Thanks']);
  expect(parseTranslations('Sure! 1. (French) Hello', 3)).toEqual([null, null, null]);
  expect(parseTranslations('1. (French) Hello\n3. Extra', 2)).toEqual(['Hello', null]);
});

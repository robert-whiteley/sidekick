import {
  cleanRulesEnglish,
  needsEnglishForRules,
  rulesEnglishPrompt,
} from '@/engine/rules-english-logic';

test('English never takes the extra pass', () => {
  expect(needsEnglishForRules('remind me to call mum at 9', 'en')).toBe(false);
});

test('likely commands in other languages do', () => {
  expect(needsEnglishForRules('Erinnere mich morgen an den Zahnarzt', 'de')).toBe(true);
  expect(needsEnglishForRules('Öffne Spotify', 'de')).toBe(true);
  expect(needsEnglishForRules('Envoie un message à Paul', 'fr')).toBe(true);
  expect(needsEnglishForRules('¿Dónde estaba ayer?', 'es')).toBe(true);
  expect(needsEnglishForRules('Wo bin ich?', 'de')).toBe(true);
  expect(needsEnglishForRules('Напомни мне позвонить маме', 'ru')).toBe(true);
  // Numbers: timers, sums and conversions in any language.
  expect(needsEnglishForRules('Hány euró 20 dollár?', 'hu')).toBe(true);
});

test('plain questions and chat skip it', () => {
  expect(needsEnglishForRules('Was ist die Hauptstadt von Frankreich?', 'de')).toBe(false);
  expect(needsEnglishForRules('Qui a écrit Les Misérables ?', 'fr')).toBe(false);
  expect(needsEnglishForRules('Kto napisał Pana Tadeusza?', 'pl')).toBe(false);
  expect(needsEnglishForRules('', 'de')).toBe(false);
});

test('the prompt keeps words to send in their own language', () => {
  const p = rulesEnglishPrompt('Schreib Sam: ich komme später');
  expect(p).toContain('inside double quotes');
  expect(p).toContain('"Schreib Sam: ich komme später"');
});

test('cleanRulesEnglish', () => {
  const q = 'Erinnere mich morgen um 9 an den Zahnarzt';
  expect(cleanRulesEnglish('English: Remind me tomorrow at 9 about the dentist\nmore', q)).toBe(
    'Remind me tomorrow at 9 about the dentist',
  );
  expect(cleanRulesEnglish('"Remind me at 9"', q)).toBe('Remind me at 9');
  expect(cleanRulesEnglish('Text Sam "ich komme später"', q)).toBe('Text Sam "ich komme später"');
  expect(cleanRulesEnglish('', q)).toBeNull();
  expect(cleanRulesEnglish(q, q)).toBeNull();
  expect(cleanRulesEnglish('x'.repeat(500), q)).toBeNull();
});

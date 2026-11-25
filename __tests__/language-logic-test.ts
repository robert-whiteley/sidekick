import {
  answerLanguageRule,
  baseLanguage,
  languageName,
  languagePlan,
  naturalVoiceAllowed,
  SPEECH_LANGUAGES,
  voiceLocale,
} from '@/engine/language-logic';
import { MODEL_FILES, OBSOLETE_MODEL_PATHS, speechFilesFor, SPEECH_FILES } from '@/engine/models';
import { ENGLISH_SYSTEM_PROMPT, setAnswerLanguage } from '@/engine/prompts';
import * as prompts from '@/engine/prompts';

test('Parakeet v3 covers 25 languages, English first', () => {
  expect(SPEECH_LANGUAGES).toHaveLength(25);
  expect(SPEECH_LANGUAGES[0].code).toBe('en');
  expect(new Set(SPEECH_LANGUAGES.map((l) => l.code)).size).toBe(25);
});

test('baseLanguage reads tags and underscores', () => {
  expect(baseLanguage('de-AT')).toBe('de');
  expect(baseLanguage('pt_BR')).toBe('pt');
  expect(baseLanguage('EN')).toBe('en');
  expect(baseLanguage('')).toBe('en');
  expect(baseLanguage(undefined)).toBe('en');
});

test('Automatic: English phones keep the English model, others get v3', () => {
  expect(languagePlan('auto', 'en-GB')).toEqual({
    language: 'en',
    answer: 'en',
    model: 'parakeet-v2',
  });
  expect(languagePlan('auto', 'de-DE')).toEqual({
    language: 'de',
    answer: 'de',
    model: 'parakeet-v3',
  });
  expect(languagePlan('auto', 'uk-UA').model).toBe('parakeet-v3');
});

test('a picked language wins over the phone', () => {
  expect(languagePlan('fr', 'en-US')).toEqual({
    language: 'fr',
    answer: 'fr',
    model: 'parakeet-v3',
  });
  expect(languagePlan('en', 'de-DE')).toEqual({
    language: 'en',
    answer: 'en',
    model: 'parakeet-v2',
  });
});

test('an unsupported phone language listens in English, answers in its own, and says why', () => {
  const p = languagePlan('auto', 'ja-JP');
  expect(p.language).toBe('en');
  expect(p.answer).toBe('ja');
  expect(p.model).toBe('parakeet-v2');
  expect(p.unsupported).toMatch(/^Not possible yet/);
});

test('natural voice is English only; voice locale keeps the phone region', () => {
  expect(naturalVoiceAllowed('en')).toBe(true);
  expect(naturalVoiceAllowed('de')).toBe(false);
  expect(voiceLocale('de', 'de_AT')).toBe('de-AT');
  expect(voiceLocale('fr', 'en-GB')).toBe('fr');
});

test('names', () => {
  expect(languageName('de')).toBe('German');
  expect(languageName('mt')).toBe('Maltese');
});

test('only one speech-to-text build is required', () => {
  const v3 = speechFilesFor('parakeet-v3');
  expect(v3).toContain(MODEL_FILES.speechToTextMulti);
  expect(v3).not.toContain(MODEL_FILES.speechToText);
  expect(speechFilesFor('parakeet-v2')).toEqual(SPEECH_FILES);
  expect(OBSOLETE_MODEL_PATHS).not.toContain(MODEL_FILES.speechToTextMulti.name);
  // Must match SpeechEngine.kt AsrChoice.V3.
  expect(MODEL_FILES.speechToTextMulti.unpackedCheck).toBe(
    'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/tokens.txt',
  );
});

test('the prompt stays exactly English for English, and asks for the language otherwise', () => {
  expect(answerLanguageRule('en')).toBe('');
  setAnswerLanguage('de');
  expect(prompts.SYSTEM_PROMPT).toContain('plain spoken German');
  expect(prompts.SYSTEM_PROMPT).toContain('Reply in German');
  setAnswerLanguage('en');
  expect(prompts.SYSTEM_PROMPT).toBe(ENGLISH_SYSTEM_PROMPT);
  expect(ENGLISH_SYSTEM_PROMPT).toContain('plain spoken English');
});

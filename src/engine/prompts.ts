import { answerLanguageRule, languageName } from './language-logic';

/** How Sidekick talks. Kept short: every token costs seconds on older phones. */
const systemPromptIn = (language: string) =>
  'You are Sidekick, a private assistant running entirely on this phone. Answer in one to three ' +
  `short sentences of plain spoken ${language}, with no lists or markdown. If you are given a photo, ` +
  "use what you can see in it. You may be given notes from the user's memory; use them only " +
  'when they answer the question, and say so if you are not sure. Never mention the notes, ' +
  'your memory or earlier questions unless the user asks about them.';

/** The English prompt, exactly as measured. */
export const ENGLISH_SYSTEM_PROMPT = systemPromptIn('English');

/**
 * The prompt in use. Reassigned by setAnswerLanguage (a live binding: importers read the current
 * value at each use).
 */
export let SYSTEM_PROMPT = ENGLISH_SYSTEM_PROMPT;

/** Answers in [language] (ISO 639-1) unless the user speaks another one; "en" restores English. */
export function setAnswerLanguage(language: string) {
  SYSTEM_PROMPT =
    language === 'en'
      ? ENGLISH_SYSTEM_PROMPT
      : systemPromptIn(languageName(language)) + answerLanguageRule(language);
}

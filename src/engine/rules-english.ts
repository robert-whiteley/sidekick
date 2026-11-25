import { currentLanguagePlan } from './language';
import {
  cleanRulesEnglish,
  needsEnglishForRules,
  RULES_ENGLISH_SYSTEM,
  rulesEnglishPrompt,
} from './rules-english-logic';

/**
 * The English version of a request in another language, for the rules (reminders, timers,
 * messages, sums…), or null when the user speaks English, it doesn't look like a command, or the
 * model fails. One short pass in a throwaway chat (loads the model if needed).
 */
export async function englishForRules(question: string): Promise<string | null> {
  const lang = currentLanguagePlan().answer;
  if (!needsEnglishForRules(question, lang)) return null;
  try {
    const { askLlm } = await import('./llm');
    const { text } = await askLlm(rulesEnglishPrompt(question), null, () => {}, {
      system: RULES_ENGLISH_SYSTEM,
      maxTokens: 80,
      scratch: true,
    });
    const en = cleanRulesEnglish(text, question);
    if (en) console.log(`[language] rules read "${en}"`);
    return en;
  } catch (e) {
    console.log(`[language] english for rules failed: ${String(e)}`);
    return null;
  }
}

/**
 * Which language Sidekick listens in, and which speech-to-text model that needs. Pure logic, tested.
 *
 * - Parakeet TDT 0.6B v2 (CC BY 4.0): English only; the default on English phones.
 * - Parakeet TDT 0.6B v3 (CC BY 4.0): 25 European languages, English included; Recommended
 *   automatically when the phone's language is one of the others.
 * Only one is downloaded at a time (~0.5 GB each). The wake word, speech detection and voiceprints
 * don't depend on the language; the natural voice (Pocket TTS) is English only, so other languages
 * are spoken by the phone's own voice.
 */

export type SpeechModelId = 'parakeet-v2' | 'parakeet-v3';

/** 'auto' follows the phone's language. */
export type LanguageChoice = 'auto' | string;

/** Languages Parakeet v3 understands (ISO 639-1), with their English and own names. */
export const SPEECH_LANGUAGES: { code: string; name: string; native: string }[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'mt', name: 'Maltese', native: 'Malti' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
];

const CODES = new Set(SPEECH_LANGUAGES.map((l) => l.code));

/** "de-AT" / "de_AT" / "DE" -> "de"; "nb"/"nn" (Norwegian) and others stay as they are. */
export function baseLanguage(locale: string | null | undefined): string {
  const m = /^([a-z]{2,3})(?![a-z])/i.exec((locale ?? '').trim());
  return m ? m[1].toLowerCase() : 'en';
}

/** English name of a language code ("de" -> "German"); Intl for ones outside the list. */
export function languageName(code: string): string {
  return SPEECH_LANGUAGES.find((l) => l.code === code)?.name ?? displayName(code);
}

export function isSupported(code: string): boolean {
  return CODES.has(code);
}

export type LanguagePlan = {
  /** The language Sidekick listens in. */
  language: string;
  /**
   * The language it answers and speaks in: the same, except when the wanted language can't be
   * heard yet; typed questions and answers still use it then (the model and the phone's voice
   * know far more languages than the speech model).
   */
  answer: string;
  model: SpeechModelId;
  /** Set when the phone's language can't be understood yet: why, in plain words. */
  unsupported?: string;
};

/**
 * The language and speech model for a choice and the phone's locale. Automatic: the phone's
 * language when Parakeet v3 knows it, else English (and says why).
 */
export function languagePlan(choice: LanguageChoice, phoneLocale: string): LanguagePlan {
  const phone = baseLanguage(phoneLocale);
  const wanted = choice === 'auto' ? phone : baseLanguage(choice);
  if (!isSupported(wanted)) {
    return {
      language: 'en',
      answer: wanted,
      model: 'parakeet-v2',
      unsupported: `Not possible yet: the on-phone speech model doesn't understand ${displayName(wanted)}, so spoken questions must be in English. Typed questions and answers can be in ${displayName(wanted)}.`,
    };
  }
  return {
    language: wanted,
    answer: wanted,
    model: wanted === 'en' ? 'parakeet-v2' : 'parakeet-v3',
  };
}

/** English name for any code (Intl when available, else the code itself). */
function displayName(code: string): string {
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
    if (n && n !== code) return n;
  } catch {
    // Older Hermes builds have no Intl.DisplayNames.
  }
  return languageName(code);
}

/** Natural voice (Pocket TTS) speaks English only; other languages use the phone's voice. */
export function naturalVoiceAllowed(language: string): boolean {
  return language === 'en';
}

/**
 * A line added to the model's instructions for non-English use. Empty for English so the
 * English prompt stays exactly as measured.
 */
export function answerLanguageRule(language: string): string {
  if (language === 'en') return '';
  return ` Reply in ${languageName(language)} unless the user writes or speaks another language; then reply in that one.`;
}

/** BCP-47 tag for the phone's voice: the phone's own locale if it is that language, else the code. */
export function voiceLocale(language: string, phoneLocale: string): string {
  return baseLanguage(phoneLocale) === language ? phoneLocale.replace('_', '-') : language;
}

/**
 * Sidekick is English-only for now: questions, answers, screens and the wake word are English
 * (full localisation is recorded in ADR 0006 "Later: full localisation"). The one multilingual
 * feature is "Understand other languages around me" (off by default): Listen uses Parakeet v3
 * (25 European languages, CC BY 4.0) instead of v2 (English only), and lines heard in another
 * language get an English translation from Gemma. Pure logic, tested.
 *
 * - Parakeet TDT 0.6B v2: English 2.9% words wrong in quiet, 7.2% at 5 dB noise (laptop, 73
 *   LibriSpeech clips).
 * - Parakeet TDT 0.6B v3: 3.8% / 17.9% on the same clips, but also hears the other 24 languages.
 * Only one is downloaded at a time (~0.5 GB each).
 */

export type SpeechModelId = 'parakeet-v2' | 'parakeet-v3';

/** Parakeet v3 is used only while "Understand other languages around me" is on. */
export function speechModelFor(understandOthers: boolean): SpeechModelId {
  return understandOthers ? 'parakeet-v3' : 'parakeet-v2';
}

/**
 * The notice after the speech build was switched to [model], or null: only when it changed from
 * the build last told about ([last], kept across restarts). A fresh install starts on v2 without
 * a word; before, every start posted "listens in English only again" (nothing had changed).
 */
export function speechModelNotice(model: SpeechModelId, last: string | null): string | null {
  if (model === last || (last === null && model === 'parakeet-v2')) return null;
  return model === 'parakeet-v3'
    ? 'Sidekick now understands 25 languages around you and translates them into English'
    : 'Sidekick listens in English only again';
}

/** Languages Parakeet v3 hears (ISO 639-1), with their English names. */
export const SPEECH_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'et', name: 'Estonian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'it', name: 'Italian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'mt', name: 'Maltese' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'uk', name: 'Ukrainian' },
];

export function languageName(code: string): string {
  return SPEECH_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

// --- Which language a heard line is in ---
// Parakeet (a transducer) reports no language, so a cheap check: the script (Cyrillic, Greek),
// then common short words and letters only some languages use. Unsure lines are left alone
// (treated as English): a wrong "translation" of English is worse than a missed one.

const STOPWORDS: Record<string, string> = {
  en: 'the and is are was you to of it that in for on with this have what not do be we they my your can',
  de: 'der die das und ist nicht ich du sie wir ein eine mit auf für zu von den dem es auch noch wie',
  fr: 'le la les et est je tu il elle nous vous une des du pas que qui pour dans avec ce sur au',
  es: 'el la los las y es que de en un una no por con para lo se del al está muy pero',
  it: 'il lo la gli le e è che di un una non per con sono ma questo anche come del della',
  pt: 'o a os as e é que de em um uma não por com para do da está muito mas você',
  nl: 'de het een en is niet ik je jij we zij van op met voor dat dit maar ook zijn heb',
  pl: 'i w nie na to jest się że z do jak co ale tak czy jestem mnie dla',
  sv: 'och är det att en ett jag du inte på med för som har vi de till av',
  da: 'og er det at en et jeg du ikke på med for som har vi de til af',
  fi: 'ja on ei se että minä sinä hän me te he mutta kun niin myös tämä',
  et: 'ja on ei see et mina sina tema me nad aga kui ka mis',
  cs: 'a je to že se na v ne jsem jak ale co tak pro',
  sk: 'a je to že sa na v nie som ako ale čo tak pre',
  sl: 'in je da se na v ne sem kako ampak kaj tako za',
  hr: 'i je da se na u ne sam kako ali što tako za',
  hu: 'a az és hogy nem van egy is de meg ez mi te én',
  ro: 'și este că de în un o nu pe cu pentru sunt dar ce',
  lv: 'un ir ka ar uz no es tu viņš mēs bet kā arī',
  lt: 'ir yra kad su į iš aš tu jis mes bet kaip taip',
  mt: 'u hu hi li ta fil għal ma jien int aħna dan',
};

const WORDS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v.split(' '))]),
);

/** Letters that point at a language (weight 2 each, once per letter kind). */
const LETTERS: [RegExp, string[]][] = [
  [/ß/, ['de']],
  [/[äöü]/, ['de', 'sv', 'fi', 'et', 'hu']],
  [/ñ/, ['es']],
  [/[ãõ]/, ['pt', 'et']],
  [/ç/, ['fr', 'pt']],
  [/[èêàù]/, ['fr', 'it']],
  [/[łąęśźżń]/, ['pl']],
  [/[řěů]/, ['cs']],
  [/[ľĺŕô]/, ['sk']],
  [/[őű]/, ['hu']],
  [/[șțăâî]/, ['ro']],
  [/[āēīūļņķģ]/, ['lv']],
  [/[ėųįū]/, ['lt']],
  [/[čšž]/, ['cs', 'sk', 'sl', 'hr', 'lv', 'lt', 'et']],
  [/đ/, ['hr']],
  [/[åø]/, ['sv', 'da']],
  [/æ/, ['da']],
  [/[ħġċ]/, ['mt']],
];

export type Detected = { code: string; confident: boolean };

/** The language of a heard line. English (not confident) when it can't tell. */
export function detectLanguage(text: string): Detected {
  const t = text.toLowerCase();
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (!letters) return { code: 'en', confident: false };
  const cyr = (t.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const greek = (t.match(/\p{Script=Greek}/gu) ?? []).length;
  if (cyr / letters.length > 0.5) {
    if (/[іїєґ]/.test(t)) return { code: 'uk', confident: true };
    if (/[ыэё]/.test(t)) return { code: 'ru', confident: true };
    if (/ъ/.test(t) && !/[ыэ]/.test(t)) return { code: 'bg', confident: true };
    return { code: 'ru', confident: letters.length >= 8 };
  }
  if (greek / letters.length > 0.5) return { code: 'el', confident: true };
  const words = t.split(/[^\p{L}']+/u).filter(Boolean);
  const score: Record<string, number> = {};
  for (const [code, set] of Object.entries(WORDS))
    score[code] = words.filter((w) => set.has(w)).length;
  for (const [re, codes] of LETTERS) if (re.test(t)) for (const c of codes) score[c] += 2;
  // English words that are also short words elsewhere ("a", "i", "de") are weak evidence.
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [best, top] = ranked[0];
  const second = ranked[1][1];
  if (best === 'en' || top === 0) return { code: 'en', confident: score.en > 0 };
  // Another language must clearly beat English (and the runner-up) to count.
  const confident = top >= 2 && top > score.en * 1.5 && top > second;
  return confident ? { code: best, confident } : { code: 'en', confident: false };
}

// --- The English translation stored with a line ---
// Kept in the moment's own text (after a marker) so search, recall, notes, recaps and answers
// all see the English without any change; the original stays first, exactly as heard.

export const TRANSLATION_MARK = '\n→ English: ';

export function withTranslation(original: string, english: string): string {
  return `${splitTranslation(original).original}${TRANSLATION_MARK}${english.trim()}`;
}

export function splitTranslation(text: string): { original: string; english: string | null } {
  const i = text.indexOf(TRANSLATION_MARK);
  if (i < 0) return { original: text, english: null };
  return { original: text.slice(0, i), english: text.slice(i + TRANSLATION_MARK.length) };
}

/** One batch: numbered lines in, numbered English lines out. */
export function translationPrompt(lines: { text: string; code: string }[]): string {
  return (
    'Translate each numbered line into natural English. Reply with the same numbers, one line ' +
    'each, only the translation:\n' +
    lines.map((l, i) => `${i + 1}. (${languageName(l.code)}) ${l.text.slice(0, 300)}`).join('\n')
  );
}

/** The translations by position; missing or empty ones are null (tried again later). */
export function parseTranslations(reply: string, count: number): (string | null)[] {
  const out: (string | null)[] = Array.from({ length: count }, () => null);
  for (const raw of reply.split('\n')) {
    const m = /^\s*(\d+)[.):]\s*(.+)$/.exec(raw);
    if (!m) continue;
    const i = Number(m[1]) - 1;
    const text = m[2]
      .replace(/^\((?:[A-Za-z ]+)\)\s*/, '')
      .replace(/^["“]|["”]$/g, '')
      .trim();
    if (i >= 0 && i < count && text) out[i] = text;
  }
  return out;
}

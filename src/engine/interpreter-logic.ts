/**
 * Two-way interpreter ("help me talk to this taxi driver in Spanish"): each person speaks their
 * own language; Sidekick shows and speaks the translation on the other side, turn by turn. Pure
 * logic (languages, the turn prompt, parsing the reply), tested in __tests__/interpreter-test.ts;
 * the session lives in interpreter.ts and the screen in src/features/interpreter.
 *
 * The model decides everything about meaning: the router picks the translate tool with
 * `talk` and the language; on the owner's turns the same reply that translates says whether the
 * owner was talking to Sidekick instead ("stop", "switch to French"). No word lists.
 *
 * Kept free of app imports so the bench (bench/interpreter) runs it under plain Node.
 */

/** Which on-device speech-to-text hears a language (Android). iPhone: Apple's on-device Speech. */
export type InterpretStt = 'parakeet-v3' | 'whisper';

export type InterpretLanguage = {
  /** ISO 639-1. */
  code: string;
  /** English name (what the model and the screen use). */
  name: string;
  /** The language's own name, shown on the other person's side. */
  own: string;
  /** BCP-47 tag for the phone's voice and Apple Speech. */
  tag: string;
  stt: InterpretStt;
};

const L = (code: string, name: string, own: string, tag: string, stt: InterpretStt) => ({
  code,
  name,
  own,
  tag,
  stt,
});

/**
 * Languages the interpreter offers. Parakeet v3 (CC BY 4.0) hears the 25 European ones; the
 * others use Whisper small (MIT), downloaded the first time one of them is needed.
 */
export const INTERPRET_LANGUAGES: InterpretLanguage[] = [
  L('en', 'English', 'English', 'en-US', 'parakeet-v3'),
  L('es', 'Spanish', 'Español', 'es-ES', 'parakeet-v3'),
  L('fr', 'French', 'Français', 'fr-FR', 'parakeet-v3'),
  L('de', 'German', 'Deutsch', 'de-DE', 'parakeet-v3'),
  L('it', 'Italian', 'Italiano', 'it-IT', 'parakeet-v3'),
  L('pt', 'Portuguese', 'Português', 'pt-PT', 'parakeet-v3'),
  L('nl', 'Dutch', 'Nederlands', 'nl-NL', 'parakeet-v3'),
  L('pl', 'Polish', 'Polski', 'pl-PL', 'parakeet-v3'),
  L('el', 'Greek', 'Ελληνικά', 'el-GR', 'parakeet-v3'),
  L('ru', 'Russian', 'Русский', 'ru-RU', 'parakeet-v3'),
  L('uk', 'Ukrainian', 'Українська', 'uk-UA', 'parakeet-v3'),
  L('sv', 'Swedish', 'Svenska', 'sv-SE', 'parakeet-v3'),
  L('da', 'Danish', 'Dansk', 'da-DK', 'parakeet-v3'),
  L('fi', 'Finnish', 'Suomi', 'fi-FI', 'parakeet-v3'),
  L('cs', 'Czech', 'Čeština', 'cs-CZ', 'parakeet-v3'),
  L('sk', 'Slovak', 'Slovenčina', 'sk-SK', 'parakeet-v3'),
  L('hu', 'Hungarian', 'Magyar', 'hu-HU', 'parakeet-v3'),
  L('ro', 'Romanian', 'Română', 'ro-RO', 'parakeet-v3'),
  L('bg', 'Bulgarian', 'Български', 'bg-BG', 'parakeet-v3'),
  L('hr', 'Croatian', 'Hrvatski', 'hr-HR', 'parakeet-v3'),
  L('sl', 'Slovenian', 'Slovenščina', 'sl-SI', 'parakeet-v3'),
  L('et', 'Estonian', 'Eesti', 'et-EE', 'parakeet-v3'),
  L('lv', 'Latvian', 'Latviešu', 'lv-LV', 'parakeet-v3'),
  L('lt', 'Lithuanian', 'Lietuvių', 'lt-LT', 'parakeet-v3'),
  L('mt', 'Maltese', 'Malti', 'mt-MT', 'parakeet-v3'),
  L('ja', 'Japanese', '日本語', 'ja-JP', 'whisper'),
  L('zh', 'Chinese', '中文', 'zh-CN', 'whisper'),
  L('ko', 'Korean', '한국어', 'ko-KR', 'whisper'),
  L('ar', 'Arabic', 'العربية', 'ar-SA', 'whisper'),
  L('tr', 'Turkish', 'Türkçe', 'tr-TR', 'whisper'),
  L('hi', 'Hindi', 'हिन्दी', 'hi-IN', 'whisper'),
  L('th', 'Thai', 'ไทย', 'th-TH', 'whisper'),
  L('vi', 'Vietnamese', 'Tiếng Việt', 'vi-VN', 'whisper'),
  L('id', 'Indonesian', 'Bahasa Indonesia', 'id-ID', 'whisper'),
  L('no', 'Norwegian', 'Norsk', 'nb-NO', 'whisper'),
  L('he', 'Hebrew', 'עברית', 'he-IL', 'whisper'),
];

export const interpretLanguage = (code: string) =>
  INTERPRET_LANGUAGES.find((l) => l.code === code) ?? null;

/**
 * The language the model named ("Spanish", "spanish", "es", "Español", "Brazilian Portuguese")
 * → one we offer, or null. Only a name lookup: which language is meant is the model's call.
 */
export function languageFromName(raw: string): InterpretLanguage | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L} -]/gu, '')
    .trim();
  if (!s) return null;
  for (const l of INTERPRET_LANGUAGES)
    if (s === l.code || s === l.name.toLowerCase() || s === l.own.toLowerCase()) return l;
  // "brazilian portuguese", "mandarin chinese", "castilian spanish": the last word names it.
  const words = s.split(/\s+/);
  for (const w of [...words].reverse())
    for (const l of INTERPRET_LANGUAGES) if (w === l.name.toLowerCase()) return l;
  const extra: Record<string, string> = {
    mandarin: 'zh',
    cantonese: 'zh',
    castilian: 'es',
    farsi: 'fa',
    bokmal: 'no',
    flemish: 'nl',
  };
  for (const w of words) {
    const c = extra[w];
    if (c) return interpretLanguage(c);
  }
  return null;
}

export type InterpretSide = 'me' | 'them';

export type InterpretTurn = {
  side: InterpretSide;
  /** What was heard, in the speaker's language. */
  heard: string;
  /** The translation into the other language (null while it is being made, or if it failed). */
  said: string | null;
  at: number;
};

/** The model's instructions for an interpreting session. */
export function interpretSystem(mine: InterpretLanguage, theirs: InterpretLanguage): string {
  return (
    `You are a live interpreter between ${mine.name} (the phone's owner) and ${theirs.name} ` +
    '(the person they are talking to). Translate faithfully and naturally, as the speaker would ' +
    'say it: keep names, numbers, prices and times exact; add nothing, explain nothing.'
  );
}

/** Earlier turns given for context (names, "it", formality); each costs reading time. */
export const CONTEXT_TURNS = 2;

/**
 * One turn, translated. The answer comes as "SAY: …" so a stray note or echo is easy to drop.
 * The owner's turns also start with "SIDEKICK:": the same call says whether the line was an
 * instruction to Sidekick (stop / use another language) rather than said to the other person, so
 * there is no second call and no word list. Wording chosen on the bench (bench/interpreter,
 * docs/BENCH.md "Interpreter"): framed as "who is it said to", Gemma 4 E2B almost never left
 * translating; without "requests to them" it also stopped on "please stop there".
 */
export function turnPrompt(
  mine: InterpretLanguage,
  theirs: InterpretLanguage,
  side: InterpretSide,
  heard: string,
  recent: InterpretTurn[] = [],
): string {
  const from = side === 'me' ? mine : theirs;
  const to = side === 'me' ? theirs : mine;
  const ctx = recent
    .filter((t) => t.said)
    .slice(-CONTEXT_TURNS)
    .map(
      (t) =>
        `${t.side === 'me' ? 'Owner' : 'Other person'}: ${t.heard.slice(0, 200)} → ${t.said!.slice(0, 200)}`,
    );
  const before = ctx.length ? `Conversation so far:\n${ctx.join('\n')}\n\n` : '';
  const who = side === 'me' ? 'Owner' : 'Other person';
  const line =
    `${before}Translate from ${from.name} into ${to.name}. Speech recognition may have small ` +
    `errors.\n${who} (${from.name}): ${heard.slice(0, 600)}\n\n`;
  if (side === 'them') return `${line}Reply\nSAY: <what they said, in ${to.name}>\nOne line only.`;
  return (
    line +
    'Is the owner giving you, the interpreter (Sidekick), an instruction about the ' +
    'interpreting itself?\n' +
    'NO = it is for the other person (also requests to them like "stop at the corner", ' +
    'goodbyes, or "is English OK?").\n' +
    'END = they ask you, the interpreter, to stop interpreting.\n' +
    'LANGUAGE: <language> = they ask you to use another language with the other person.\n\n' +
    `Reply\nSIDEKICK: <NO, END or LANGUAGE: <language>>\nSAY: <what they said, in ${to.name}>`
  );
}

export type ControlReply = { kind: 'stop' } | { kind: 'switch'; language: string } | null;

/**
 * The "SIDEKICK:" line of an owner's turn → stop, switch, or null (for the other person:
 * translate it). Anything unreadable or missing is null, so the turn is translated as normal.
 */
export function parseControlReply(reply: string): ControlReply {
  const m = /(?:^|\n)\s*\**SIDEKICK\s*\**\s*:\s*\**\s*([^\n]*)/i.exec(reply.replace(/`/g, ''));
  if (!m) return null;
  const t = m[1].replace(/\*/g, '').trim();
  if (/^(END|STOP)\b/i.test(t)) return { kind: 'stop' };
  const sw = /^(?:LANGUAGE|SWITCH)\s*:?\s*(.+)$/i.exec(t);
  if (sw) {
    const language = sw[1].replace(/[."<>]+/g, '').trim();
    return language && !/^language$/i.test(language) ? { kind: 'switch', language } : null;
  }
  return null;
}

/** Tokens for one reply: a long sentence in a wordy language, plus the "SIDEKICK:" and "SAY:" lines. */
export const TURN_MAX_TOKENS = 160;

const same = (a: string, b: string) =>
  a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') ===
  b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The model's reply → the translation, or null. A bare line without "SAY:" counts; a line that
 * only repeats what was heard (the model sometimes echoes it before the translation) is skipped.
 */
export function parseTurnReply(reply: string, heard = ''): string | null {
  const text = reply
    .replace(/```[a-z]*\n?/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
  if (!text) return null;
  const say = /\bSAY\s*\**\s*:\s*\**\s*([^\n]+)/i.exec(text);
  const lines = say
    ? [say[1]]
    : text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^\**SIDEKICK\s*\**\s*:/i.test(l));
  // ("Taxi!" or a name can be the same in both languages: a lone echo stays.)
  const pick = lines.find((l) => !heard || !same(l, heard)) ?? lines[0] ?? '';
  return pick.replace(/^["“«「]+|["”»」]+$/g, '').trim() || null;
}

/** The streamed reply so far → the translation text to show while it is still coming. */
export function partialTranslation(reply: string): string | null {
  // Not shown while the owner's line is for Sidekick ("SIDEKICK: END" comes before "SAY:").
  if (parseControlReply(reply)) return null;
  const m = /\bSAY\s*\**\s*:\s*\**\s*([^\n]*)/i.exec(reply);
  if (!m) return null;
  return m[1].replace(/^["“«「]+/, '').trim() || null;
}

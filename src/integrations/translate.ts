/**
 * Translation with the on-device model: "translate good morning into Spanish", "how do you say
 * thank you in Japanese", and "translate this" for the text the camera (or a screenshot) sees,
 * read exactly with OCR first. Pure; tested in __tests__/translate-test.ts.
 */

export type TranslateRequest = {
  /** The words to translate; empty for "translate this" (the text in view). */
  text: string;
  /** Language name as said, e.g. "Spanish"; English when not said. */
  target: string;
  fromView: boolean;
};

const LANGS =
  'english|spanish|french|german|italian|portuguese|dutch|polish|swedish|norwegian|danish|finnish|greek|turkish|russian|ukrainian|czech|hungarian|romanian|arabic|hebrew|hindi|urdu|bengali|punjabi|tamil|thai|vietnamese|indonesian|malay|filipino|tagalog|chinese|mandarin|cantonese|japanese|korean|welsh|irish|swahili|persian|farsi|catalan|croatian|serbian|bulgarian|slovak|latin';

const LANG = `(${LANGS})`;
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const strip = (s: string) =>
  s
    .trim()
    .replace(/^["“'‘]|["”'’]$/g, '')
    .trim();

export function parseTranslate(question: string): TranslateRequest | null {
  const q = question
    .trim()
    .replace(/^(?:hey |ok )?(?:sidekick,? )?(?:please |(?:can|could) you )?/i, '')
    .replace(/[?.!\s]+$/, '');
  let m: RegExpExecArray | null;
  // "translate this (sign/menu/text) (into French)"
  if (
    (m = new RegExp(
      `^(?:translate|what does) (?:this|that|it|the (?:sign|menu|text|label|page|screen))(?: (?:sign|menu|text|label|page|say|mean|says))*(?: (?:in|into|to) ${LANG})?$`,
      'i',
    ).exec(q))
  )
    return { text: '', target: title(m[1] ?? 'english'), fromView: true };
  if ((m = new RegExp(`^translate (.+?) (?:in|into|to) ${LANG}$`, 'i').exec(q)))
    return { text: strip(m[1]), target: title(m[2]), fromView: false };
  if (
    (m = new RegExp(
      `^(?:how (?:do|would) (?:you|i) say|what(?:'s| is)) (.+?) in ${LANG}$`,
      'i',
    ).exec(q))
  )
    return { text: strip(m[1]), target: title(m[2]), fromView: false };
  if ((m = /^translate (.+)$/i.exec(q)))
    return { text: strip(m[1]), target: 'English', fromView: false };
  return null;
}

/** One prompt for the model: only the translation comes back, no chat around it. */
export function translatePrompt(text: string, target: string): string {
  return `Translate the text between the markers into ${target}. Reply with only the translation, nothing else. If it is already in ${target}, translate it into English instead.\n<<<\n${text.trim()}\n>>>`;
}

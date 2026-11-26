/**
 * Translation with the on-device model: "translate good morning into Spanish", "how do you say
 * thank you in Japanese", and "translate this" for the text the camera (or a screenshot) sees,
 * read exactly with OCR first. Pure; tested in __tests__/translate-test.ts.
 */

/** One prompt for the model: only the translation comes back, no chat around it. */
export function translatePrompt(text: string, target: string): string {
  return `Translate the text between the markers into ${target}. Reply with only the translation, nothing else. If it is already in ${target}, translate it into English instead.\n<<<\n${text.trim()}\n>>>`;
}

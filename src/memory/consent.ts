/**
 * Consent mode: other people's speech is only kept after they agree. The owner asks ("is it OK
 * if I take notes?") and a different voice answers yes within the next 30 seconds.
 */
const ASK =
  /\b(ok|okay|alright|all right|mind|fine)\b.*\b(take notes|record|recording|transcribe|write this down|note this)\b|\b(can|may) i (record|take notes|transcribe)\b/i;
const YES =
  /^(yes|yeah|yep|yup|sure|of course|ok|okay|fine|go ahead|no problem|absolutely|that's fine|that is fine|i don't mind|no i don't mind|not at all)\b/i;
export const CONSENT_WINDOW_MS = 30_000;

export function isConsentQuestion(text: string): boolean {
  return ASK.test(text);
}

export function isAgreement(text: string): boolean {
  return YES.test(text.trim());
}

/** Decides whether to keep a non-owner speech clip. */
export function keepOtherSpeech(opts: {
  consentMode: boolean;
  speakerConsented: boolean;
}): boolean {
  return !opts.consentMode || opts.speakerConsented;
}

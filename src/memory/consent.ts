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

/**
 * What happens to a line and its voice. A voice is stored only together with a line of theirs
 * that is kept (SPEC 4: voices that have not consented are not stored); until then it lives in
 * memory for the conversation (unsaved-voices.ts). [agrees]: this line is a yes within
 * CONSENT_WINDOW_MS of the owner asking; it counts only when the line has a voice to attach it to.
 */
export function lineFate(o: {
  consentMode: boolean;
  isOwner: boolean;
  hasVoice: boolean;
  consented: boolean;
  agrees: boolean;
}): { keep: boolean; consentNow: boolean } {
  if (o.isOwner) return { keep: true, consentNow: false };
  const consentNow = o.hasVoice && !o.consented && o.agrees;
  return {
    keep: keepOtherSpeech({
      consentMode: o.consentMode,
      speakerConsented: o.consented || consentNow,
    }),
    consentNow,
  };
}

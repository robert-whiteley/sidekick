/** Speaker clustering from voiceprints, with no enrolment. Pure functions; tested. */

export type Speaker = { id: number; centroid: number[]; count: number; isOwner: boolean };

/**
 * Same-voice threshold for 3D-Speaker CAM++ cosine similarity. On LibriSpeech (20 speakers) 0.55
 * merged two people ~0.01% of the time; the highest score between different people was 0.60.
 */
export const SAME_VOICE = 0.55;

/**
 * Shortest clip that may start a new person. Short first clips caused most duplicate "persons"
 * (25 for 20 real speakers); from 2.5 s a voiceprint is near-reliable. Shorter unmatched clips stay
 * unattributed ("Someone") instead.
 */
export const NEW_VOICE_MIN_MS = 2500;

/** Whether an unmatched clip is long enough to become a new person. */
export const canStartNewVoice = (durationMs: number | undefined) =>
  (durationMs ?? 0) >= NEW_VOICE_MIN_MS;

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The known speaker this voice belongs to, or null for a new voice. */
export function matchSpeaker(voice: number[], speakers: Speaker[]): Speaker | null {
  let best: Speaker | null = null;
  let bestSim = SAME_VOICE;
  for (const s of speakers) {
    const sim = cosine(voice, s.centroid);
    if (sim >= bestSim) {
      best = s;
      bestSim = sim;
    }
  }
  return best;
}

/** The owner's voice (only it may interrupt a spoken answer), or null while not known yet. */
export const ownerCentroid = (speakers: Speaker[]): number[] | null =>
  speakers.find((s) => s.isOwner)?.centroid ?? null;

/** Running mean, so a speaker's centroid gets better with every clip. */
export function addToCentroid(s: Speaker, voice: number[]): number[] {
  const n = Math.min(s.count, 50); // cap the weight so the voice can drift (colds, mics)
  return s.centroid.map((c, i) => (c * n + voice[i]) / (n + 1));
}

/**
 * Whether a clip flagged as the owner (a question after the wake word) really is them. Anyone can
 * say the wake word, so once the owner's voice is known, a clip that doesn't sound like them is
 * matched like any other voice instead of being learned into the owner's voiceprint. Push-to-talk
 * clips skip this: holding the button is the owner.
 */
export function ownerClaimHolds(voice: number[], owner: Speaker | null): boolean {
  return !owner || cosine(voice, owner.centroid) >= SAME_VOICE;
}

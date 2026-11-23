/** Speaker clustering from voiceprints, with no enrolment. Pure functions; tested. */

export type Speaker = { id: number; centroid: number[]; count: number; isOwner: boolean };

/** Same-voice threshold for 3D-Speaker CAM++ cosine similarity (tune on device). */
export const SAME_VOICE = 0.55;

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

/** Running mean, so a speaker's centroid gets better with every clip. */
export function addToCentroid(s: Speaker, voice: number[]): number[] {
  const n = Math.min(s.count, 50); // cap the weight so the voice can drift (colds, mics)
  return s.centroid.map((c, i) => (c * n + voice[i]) / (n + 1));
}

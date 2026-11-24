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

/** Under this a voiceprint is too noisy to learn from or to count as the owner (native 1.5 s). */
export const RELIABLE_VOICE_MS = 1500;

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

/**
 * Looser match for a clip too short to start a new person (under NEW_VOICE_MIN_MS). Short clips
 * give noisier voiceprints, so instead of showing them as "Someone" they join a known other voice
 * when it is clearly the closest: at least SHORT_CLIP_SIM and SHORT_CLIP_MARGIN above every other
 * voice, the owner included. Never the owner (only a full match may count as the owner, who can
 * interrupt answers). The centroid is not updated from such clips.
 */
export const SHORT_CLIP_SIM = 0.45;
export const SHORT_CLIP_MARGIN = 0.1;

export function matchShortClip(voice: number[], speakers: Speaker[]): Speaker | null {
  let best: Speaker | null = null;
  let bestSim = -1;
  let second = -1;
  for (const s of speakers) {
    const sim = cosine(voice, s.centroid);
    if (sim > bestSim) {
      second = bestSim;
      best = s;
      bestSim = sim;
    } else if (sim > second) second = sim;
  }
  if (!best || best.isOwner || bestSim < SHORT_CLIP_SIM) return null;
  return bestSim - Math.max(second, 0) >= SHORT_CLIP_MARGIN ? best : null;
}

/** A short clip nobody matched yet; re-checked when a new voice appears. */
export type PendingClip = { at: number; voice: number[]; momentId: number | null };
/** How long an unattributed short clip waits for its voice to become known. */
export const PENDING_CLIP_MS = 60_000;

/**
 * After a new voice joins, which waiting clips now clearly belong to it. Returns those clips and
 * the ones still waiting (older than PENDING_CLIP_MS are dropped).
 */
export function claimPending(
  pending: PendingClip[],
  joined: Speaker,
  speakers: Speaker[],
  now: number,
): { claimed: PendingClip[]; waiting: PendingClip[] } {
  const claimed: PendingClip[] = [];
  const waiting: PendingClip[] = [];
  for (const p of pending) {
    if (now - p.at > PENDING_CLIP_MS) continue;
    if (matchShortClip(p.voice, speakers)?.id === joined.id) claimed.push(p);
    else waiting.push(p);
  }
  return { claimed, waiting };
}

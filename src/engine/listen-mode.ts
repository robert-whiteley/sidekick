/**
 * "Instructions only": for when you are with other people. Nothing around you is transcribed or
 * kept; only push-to-talk and the wake word ("Sidekick" or "Hey Sidekick") are taken, as
 * questions. Separate from "Show conversation", which only hides the transcript. Pure; tested.
 */
export type ListenPlan = {
  /** Journal ambient speech (conversations) into memory. */
  recordAmbient: boolean;
  /** Native: transcribe a segment only right after the wake word, in a follow-up, or push-to-talk. */
  commandsOnly: boolean;
};

export function listenPlan(s: {
  recordConversations: boolean;
  instructionsOnly: boolean;
}): ListenPlan {
  if (s.instructionsOnly) return { recordAmbient: false, commandsOnly: true };
  return { recordAmbient: s.recordConversations, commandsOnly: false };
}

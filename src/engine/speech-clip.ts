/** A heard line that may have its recording kept. */
type HeardLine = { at: number; kind: string; audioPath?: string | null };

const ASKS_ABOUT_SPEECH =
  /\b(say|said|says|saying|tell|told|mention(ed)?|talk(ed)?|ask(ed)?|promised?|agreed?|hear|heard)\b/i;

/**
 * "What did Sam say about the rent?": the best-matching heard line's recording, so it can be
 * played back. Only for questions about something said, and only lines with saved audio.
 */
export function speechClipFor(
  question: string,
  sources: HeardLine[],
): { momentAt: number; kind: 'audio'; path: string }[] | undefined {
  if (!ASKS_ABOUT_SPEECH.test(question)) return undefined;
  const line = sources.find((m) => m.audioPath && (m.kind === 'speech' || m.kind === 'question'));
  return line?.audioPath ? [{ momentAt: line.at, kind: 'audio', path: line.audioPath }] : undefined;
}

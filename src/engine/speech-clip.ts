/** A heard line that may have its recording kept. */
type HeardLine = { at: number; kind: string; audioPath?: string | null };

/**
 * "Play me what Sam said about the rent": the best-matching heard line's recording, so it can be
 * played back. Only asked for when the model picked play_recording (tools-logic.ts), never for
 * other questions; only lines with saved audio.
 */
export function speechClipFor(
  sources: HeardLine[],
): { momentAt: number; kind: 'audio'; path: string }[] | undefined {
  const line = sources.find((m) => m.audioPath && (m.kind === 'speech' || m.kind === 'question'));
  return line?.audioPath ? [{ momentAt: line.at, kind: 'audio', path: line.audioPath }] : undefined;
}

/** A heard line that may have its recording kept. */
type HeardLine = { at: number; kind: string; text?: string; audioPath?: string | null };

type Clip = { momentAt: number; kind: 'audio'; path: string }[];

const heard = (m: HeardLine) => !!m.audioPath && (m.kind === 'speech' || m.kind === 'question');

const clip = (m: HeardLine | undefined): Clip | undefined =>
  m?.audioPath ? [{ momentAt: m.at, kind: 'audio', path: m.audioPath }] : undefined;

/**
 * "Play me what Sam said about the rent": the best-matching heard line's recording, so it can be
 * played back. Only when the model picked play_recording (tools-logic.ts).
 */
export function speechClipFor(sources: HeardLine[]): Clip | undefined {
  return clip(sources.find(heard));
}

/** The heard lines with saved audio that were in the answer's prompt (at most a few). */
export const clipCandidates = (sources: HeardLine[]) => sources.filter(heard).slice(0, 6);

export const USED_CLIP_SYSTEM =
  'You check where an answer came from. Reply with one number only: the line the answer is ' +
  'drawn from, or 0 if it is drawn from none of them.';

export function usedClipPrompt(question: string, answer: string, lines: HeardLine[]): string {
  const list = lines.map((m, i) => `${i + 1}. ${(m.text ?? '').slice(0, 240)}`).join('\n');
  return `Heard lines:\n${list}\n\nQuestion: ${question}\nAnswer: ${answer.slice(0, 600)}\n\nLine number:`;
}

/** The model's number → that line (1-based), or none. */
export function parseUsedClip(reply: string, lines: HeardLine[]): HeardLine | undefined {
  const n = Number(/\d+/.exec(reply)?.[0] ?? 0);
  return n >= 1 && n <= lines.length ? lines[n - 1] : undefined;
}

/**
 * "What did Tom say about the meeting?": the recording of the heard line the answer was actually
 * drawn from, decided by the model in a short throwaway check; nothing when the answer used none
 * (or no heard line with audio was in the prompt, so no check is run).
 */
export async function usedSpeechClip(
  question: string,
  answer: string,
  sources: HeardLine[],
  ask: (prompt: string, system: string) => Promise<string>,
): Promise<Clip | undefined> {
  const lines = clipCandidates(sources);
  if (!lines.length || !answer.trim()) return undefined;
  const reply = await ask(usedClipPrompt(question, answer, lines), USED_CLIP_SYSTEM).catch(
    () => '',
  );
  return clip(parseUsedClip(reply, lines));
}

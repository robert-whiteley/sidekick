import { askLlm } from './llm';
import type { Moment } from '@/memory/store';
import {
  rememberExchange,
  rememberPhotoQuestion,
  saveFact,
  savedFacts,
  searchMemory,
} from '@/memory/store';
import { asksAboutSomethingSeen } from '@/memory/search-logic';

/** How Sidekick talks. Kept short: every token costs seconds on older phones. */
export const SYSTEM_PROMPT =
  'You are Sidekick, a private assistant running entirely on this phone. Answer in one to three ' +
  'short sentences of plain spoken English, with no lists or markdown. If you are given a photo, ' +
  "use what you can see in it. You may be given notes from the user's memory; use them only " +
  'when they are relevant, and say so if you are not sure.';

export const DEFAULT_PHOTO_QUESTION = 'What am I looking at?';

const REMEMBER = /^(please )?remember(?: that)? (.+)$/i;

function when(at: number): string {
  const d = new Date(at);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function who(m: Moment): string {
  if (m.kind === 'photo') return 'photo';
  if (m.kind === 'answer') return 'asked Sidekick';
  if (m.isOwner) return 'you';
  return m.speakerName ?? 'someone';
}

/** Memory notes as compact lines for the prompt. */
export function memoryContext(moments: Moment[], facts: string[]): string {
  const lines = [
    ...facts.map((f) => `- Saved fact: ${f}`),
    ...moments.map(
      (m) => `- [${when(m.at)}] (${who(m)}) ${m.text.replace(/\s+/g, ' ').slice(0, 300)}`,
    ),
  ];
  return lines.length ? `Notes from the user's memory:\n${lines.join('\n')}\n\n` : '';
}

export type AnswerResult = {
  text: string;
  usedPhoto: string | null;
  sources: Moment[];
  ms: number;
  ttftMs: number;
};

/**
 * Answers a question using, in order: a photo just taken; else the user's memory, re-reading the
 * original photo of a remembered moment when the question is about something seen.
 */
export async function answer(
  question: string,
  photoNow: string | null,
  onText: (full: string) => void,
): Promise<AnswerResult> {
  const remember = REMEMBER.exec(question.trim());
  if (remember && !photoNow && !question.trim().endsWith('?')) {
    await saveFact(remember[2].replace(/[.!]+$/, ''));
    const text = "Got it, I'll remember that.";
    onText(text);
    return { text, usedPhoto: null, sources: [], ms: 0, ttftMs: 0 };
  }

  let sources: Moment[] = [];
  let facts: string[] = [];
  try {
    [sources, facts] = await Promise.all([
      searchMemory(question, photoNow ? 3 : 6),
      savedFacts().then((f) =>
        f
          .filter((x) => x.status === 'saved')
          .slice(0, 10)
          .map((x) => x.text),
      ),
    ]);
  } catch (e) {
    console.log(`[assistant] memory unavailable: ${String(e)}`);
  }

  let image = photoNow;
  if (!image && asksAboutSomethingSeen(question)) {
    image = sources.find((m) => m.photoPath)?.photoPath ?? null;
  }

  const prompt = `${memoryContext(sources, facts)}Question: ${question}`;
  const { text, stats } = await askLlm(prompt, image, onText, { system: SYSTEM_PROMPT });

  if (photoNow) await rememberPhotoQuestion(photoNow, question, text).catch(() => {});
  else await rememberExchange(question, text).catch(() => {});

  return { text, usedPhoto: image, sources, ms: stats.totalMs, ttftMs: stats.ttftMs };
}

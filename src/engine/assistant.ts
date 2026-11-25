import { askLlm } from './llm';
import { SYSTEM_PROMPT } from './prompts';
import type { Moment } from '@/memory/store';
import { MEMORY_LIMIT, memoryContext, pickFacts } from './prompt-budget';
import {
  rememberExchange,
  rememberPhotoQuestion,
  saveFact,
  savedFacts,
  searchMemory,
} from '@/memory/store';
import { asksAboutSomethingSeen } from '@/memory/search-logic';
import { ocrPromptLine } from '@/memory/photo-text';
import { photoTextOrNull } from './photo-ocr';
import { answerLocally } from '@/memory/sources';
import {
  asksAboutFollowups,
  followupContext,
  formatDue,
  parseReminderRequest,
} from '@/memory/followup-logic';
import { addFollowup, listFollowups } from '@/memory/followups';
import { personPromptContext } from '@/memory/people';
import { askWithLookup, type WebSource } from '@/web/lookup';

export { SYSTEM_PROMPT, memoryContext };

export const DEFAULT_PHOTO_QUESTION = 'What am I looking at?';

const REMEMBER = /^(please )?remember(?: that)? (.+)$/i;

export type AnswerResult = {
  text: string;
  usedPhoto: string | null;
  sources: Moment[];
  ms: number;
  ttftMs: number;
  /** Online lookup results the answer used (Settings > Online lookup; off by default). */
  web?: WebSource[];
  /** The search words sent, when a lookup ran (reused by the browser link). */
  webQuery?: string;
  /** Answered here without the model (a saved fact, reminder or contact); no web link. */
  local?: boolean;
};

/**
 * Answers a question using, in order: a photo just taken; else the user's memory, re-reading the
 * original photo of a remembered moment when the question is about something seen.
 */

/** The last question asked, for a spoken follow-up's search words. */
let lastQuestion: string | undefined;

export async function answer(
  question: string,
  photoNow: string | null,
  onText: (full: string) => void,
  /** keepHistory: a follow-up in a spoken conversation; the model keeps the earlier turns. */
  opts?: { keepHistory?: boolean },
): Promise<AnswerResult> {
  const remember = REMEMBER.exec(question.trim());
  if (remember && !photoNow && !question.trim().endsWith('?')) {
    await saveFact(remember[2].replace(/[.!]+$/, ''));
    const text = "Got it, I'll remember that.";
    onText(text);
    return { text, usedPhoto: null, sources: [], ms: 0, ttftMs: 0, local: true };
  }

  // "Remind me to … at …": scheduled for real, here, so the reply never claims what didn't happen.
  const reminder = photoNow ? null : parseReminderRequest(question, new Date());
  if (reminder) {
    await addFollowup(reminder);
    // "tomorrow 09:00" → "tomorrow at 09:00"
    const due = formatDue(reminder, new Date()).replace(/ (\d{1,2}[:.]\d{2}\D*)$/, ' at $1');
    const what = reminder.title.charAt(0).toLowerCase() + reminder.title.slice(1);
    const text = due
      ? `OK, I'll remind you to ${what} ${due}.`
      : `I've added "${reminder.title}" to your to-dos. Say a time if you want a reminder.`;
    onText(text);
    return { text, usedPhoto: null, sources: [], ms: 0, ttftMs: 0, local: true };
  }

  // "What's Sam's number": straight from contacts (when on), no model needed.
  const local = photoNow ? null : await answerLocally(question).catch(() => null);
  if (local) {
    onText(local);
    return { text: local, usedPhoto: null, sources: [], ms: 0, ttftMs: 0, local: true };
  }

  let sources: Moment[] = [];
  let facts: string[] = [];
  try {
    [sources, facts] = await Promise.all([
      // A few extra candidates so a remembered photo can still be found below.
      searchMemory(question, photoNow ? MEMORY_LIMIT.photo : MEMORY_LIMIT.text + 2),
      savedFacts().then((f) =>
        pickFacts(
          f.filter((x) => x.status === 'saved').map((x) => x.text),
          question,
        ),
      ),
    ]);
  } catch (e) {
    console.log(`[assistant] memory unavailable: ${String(e)}`);
  }

  let image = photoNow;
  if (!image && asksAboutSomethingSeen(question)) {
    image = sources.find((m) => m.photoPath)?.photoPath ?? null;
  }

  // Only the best few notes reach the model: each prompt token delays the first word.
  sources = sources.slice(0, photoNow ? MEMORY_LIMIT.photo : MEMORY_LIMIT.text);
  // "What do I need to do?": the approved follow-ups go first.
  const agenda =
    !photoNow && asksAboutFollowups(question)
      ? followupContext(await listFollowups().catch(() => []), new Date())
      : '';
  // "What did I ask Sam to do?": the named person's notes, kept facts and requests.
  const person = await personPromptContext(question).catch(() => '');
  // The photo's exact text (OCR, ~1 s) helps the model read numbers and names right.
  const seenText = ocrPromptLine(await photoTextOrNull(image));
  // Online lookup (when on) sends only the question text; the prompt itself stays on the phone.
  const { text, stats, web, webQuery } = await askWithLookup(
    question,
    !!image,
    (webPart) =>
      `${agenda}${person}${webPart}${memoryContext(sources, facts, sources.length, question)}${seenText}Question: ${question}`,
    (prompt, t, o) =>
      askLlm(prompt, image, t, {
        system: SYSTEM_PROMPT,
        keepHistory: opts?.keepHistory ?? false,
        undoable: o?.undoable,
      }),
    onText,
    undefined,
    opts?.keepHistory ? lastQuestion : undefined,
  );
  lastQuestion = question;

  if (photoNow) await rememberPhotoQuestion(photoNow, question, text).catch(() => {});
  else await rememberExchange(question, text).catch(() => {});

  return {
    text,
    usedPhoto: image,
    sources,
    ms: stats.totalMs,
    ttftMs: stats.ttftMs,
    web,
    webQuery,
  };
}

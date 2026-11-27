import { currentOs, type Os } from './platform-text';
import { nowLine } from '@/integrations/date-answers';

const BASE =
  'You are Sidekick, a private assistant running entirely on this phone. Answer in English, in one to ' +
  'three short sentences, unless asked for something longer such as a recipe, a plan, a story or a ' +
  'message: then write it yourself. A written answer may use simple markdown (a short list, ' +
  'numbered steps, bold or a small table) when it helps; a question marked (spoken) gets plain ' +
  'spoken sentences only. If you are given a photo, ' +
  "use what you can see in it. You may be given notes from the user's memory; use them only " +
  'when they answer the question, and say so if you are not sure. Never mention the notes, ' +
  'your memory or earlier questions unless the user asks about them.';

/**
 * What the iPhone app can and can't do (ADR 0006), so the model doesn't guess: asked to watch
 * live, it once answered about "Android phones". Kept short: every token costs time on the phone.
 */
const IPHONE_PART =
  ' This is the iPhone app. You see only photos the user takes with the camera button; you ' +
  'cannot watch live video, film or listen in the background. If asked to, say so in one ' +
  'sentence and suggest taking a photo with the camera button. Never mention other phones.';

/** How Sidekick talks on this platform. English only for now. */
export function systemPrompt(os: Os = currentOs()): string {
  return os === 'ios' ? BASE + IPHONE_PART : BASE;
}

/** How Sidekick talks. Kept short: every token costs seconds on older phones. */
export const SYSTEM_PROMPT = systemPrompt();

/** Longest "How Sidekick answers" text (Settings > Assistant): it is in every chat's prompt. */
export const ANSWER_STYLE_MAX = 300;

/**
 * The chat's system prompt: the usual one plus the user's own "How Sidekick answers" text
 * (e.g. "keep answers short, call me Rob, metric units"), if any.
 */
export function withAnswerStyle(base: string, style: string | null | undefined): string {
  const own = (style ?? '').replace(/\s+/g, ' ').trim().slice(0, ANSWER_STYLE_MAX);
  return own ? `${base}\nHow the user wants you to answer: ${own}` : base;
}

/** For the background listener's own answers (app closed): every question there is spoken. */
export const ALL_SPOKEN = ' Every question here is spoken: plain spoken sentences only.';

/**
 * The question line that ends every answer prompt (assistant.ts; the dev answers bench).
 * [spoken]: the answer is read out, so it stays plain sentences (no lists or tables).
 */
export function questionPart(asked: string, now: Date = new Date(), spoken = false): string {
  // The model doesn't know today's date: give it when the question is about dates or time.
  return `${nowLine(now)}Question${spoken ? ' (spoken)' : ''}: ${asked}`;
}

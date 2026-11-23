/**
 * How much memory goes into a prompt. Every prompt token is read (prefilled) before the first word
 * comes out, and on a CPU-only phone that is the bulk of the wait, so only the few notes most
 * likely to answer the question go in, each cut to its gist. Pure; tested.
 */
import type { Moment } from '@/memory/store';
import { SOURCE_LABEL } from '@/memory/sources-logic';

/** Ranked memories asked for: a photo answers most of a photo question itself. */
export const MEMORY_LIMIT = { photo: 2, text: 4 } as const;
/** Saved facts included at most (see [pickFacts]). */
export const FACT_LIMIT = 5;
/** Characters kept per memory / fact. ~180 chars is ~40 tokens. */
export const MOMENT_CHARS = 180;
export const FACT_CHARS = 120;

/** Collapses whitespace and cuts to [max] characters at a word boundary, adding "…" if cut. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  // A space right after the cut means the last word is whole.
  const space = t.slice(0, max).lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * Like [clip], but keeps the part of a long note that best matches [question] (most shared words),
 * so a long file passage or transcript shows its relevant sentences, not just its opening.
 */
export function clipAround(text: string, question: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max || !question) return clip(t, max);
  const q = words(question);
  const sentences = t.match(/[^.!?]+[.!?]*\s*/g) ?? [t];
  let best = { start: 0, score: -1 };
  for (let i = 0; i < sentences.length; i++) {
    let window = '';
    for (let j = i; j < sentences.length && window.length < max; j++) window += sentences[j];
    const score = [...words(window.slice(0, max))].filter((w) => q.has(w)).length;
    if (score > best.score) best = { start: i, score };
  }
  const from = sentences.slice(best.start).join('');
  return `${best.start > 0 ? '…' : ''}${clip(from, max)}`;
}

const COMMON = new Set(
  'the and are was were what when where which who why how you your for with that this did does have has from'.split(
    ' ',
  ),
);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !COMMON.has(w)),
  );

/**
 * The [n] saved facts sharing the most words with [question]; ties keep the given order (newest
 * first), so with no overlap the newest facts win.
 */
export function pickFacts(facts: string[], question: string, n = FACT_LIMIT): string[] {
  const q = words(question);
  const score = (f: string) => [...words(f)].filter((w) => q.has(w)).length;
  return facts
    .map((f, i) => ({ f, i, s: score(f) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, n)
    .map((x) => x.f);
}

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
  if (m.kind === 'photo')
    return m.withPeople?.length ? `photo, with ${m.withPeople.join(', ')}` : 'photo';
  if (m.kind === 'answer') return 'asked Sidekick';
  const source = (SOURCE_LABEL as Record<string, string | undefined>)[m.kind];
  if (source) return source;
  if (m.isOwner) return 'you';
  return m.speakerName ?? 'someone';
}

/**
 * Memory notes as compact lines for the prompt: at most [FACT_LIMIT] facts and [maxMoments]
 * moments (already ranked best first), each clipped.
 */
export function memoryContext(
  moments: Moment[],
  facts: string[],
  maxMoments: number = MEMORY_LIMIT.text,
  question = '',
): string {
  const lines = [
    ...facts.slice(0, FACT_LIMIT).map((f) => `- Saved fact: ${clip(f, FACT_CHARS)}`),
    ...moments
      .slice(0, maxMoments)
      .map(
        (m) =>
          `- [${when(m.at)}${m.place ? `, in ${m.place}` : ''}] (${who(m)}) ${clipAround(m.text, question, MOMENT_CHARS)}`,
      ),
  ];
  return lines.length ? `Notes from the user's memory:\n${lines.join('\n')}\n\n` : '';
}

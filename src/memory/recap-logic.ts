/**
 * Recaps over any time range or topic ("recap the last 2 hours", "what did we talk about last
 * Tuesday", "recap what we've been working on"), built when asked (no fixed daily recap).
 * Pure; tested in __tests__/recap-logic-test.ts.
 */
import { type TimeRange } from './time-range';

export type RecapRequest = {
  /** The time range said, or null (then a topic stretch, or today). */
  range: TimeRange | null;
  /** What it is about ("the budget"), or null for everything. */
  topic: string | null;
  /** "What have we been working on": find the stretch of related activity ending now. */
  stretch: boolean;
};

/** Removes time phrases so they don't count as a topic ("about the budget yesterday"). */
export function withoutTimeWords(q: string): string {
  return q
    .replace(
      /\b(between|from) \d{1,2}([:.]\d{2})? ?(am|pm)? (and|to|until|till) \d{1,2}([:.]\d{2})? ?(am|pm)?/gi,
      ' ',
    )
    .replace(/\bsince ([a-z0-9:.]+( up| home)?)/gi, ' ')
    .replace(
      /\b(an?|\d+|one|two|three|four|five|six|ten|(a )?couple( of)?|(a )?few|several) (minute|min|hour|hr|day|week|month)s? ago\b/gi,
      ' ',
    )
    .replace(
      /\b(in |over |during )?(the )?(last|past|previous) (\S+ )?(half )?(an )?(minute|min|hour|hr|day|week|month|year|night|weekend)s?\b/gi,
      ' ',
    )
    .replace(
      /\b(on |last |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)( morning| afternoon| evening| night)?\b/gi,
      ' ',
    )
    .replace(
      /\b(this|yesterday|today|tonight|earlier|so far|this week|this month|this year|over the weekend|this weekend|lately|recently)( morning| afternoon| evening| today)?\b/gi,
      ' ',
    )
    .replace(
      /\b(in |during |on (the )?)?(\d{1,2}(st|nd|rd|th)? (of )?)?(january|february|march|april|may|june|july|august|september|october|november|december)( \d{1,2}(st|nd|rd|th)?)?\b/gi,
      ' ',
    )
    .replace(/\b(at|around|about) \d{1,2}([:.]\d{2})? ?(am|pm|o'?clock)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A moment considered for a stretch: when, and whether it is about the topic. */
export type StretchItem = { at: number; related: boolean };

/** Gaps allowed between related moments, and the longest stretch looked back. */
export const STRETCH_GAP_MS = 45 * 60_000;
export const TOPIC_GAP_MS = 3 * 3_600_000;
export const STRETCH_MAX_MS = 12 * 3_600_000;
export const TOPIC_MAX_MS = 3 * 86_400_000;

/**
 * The continuous stretch of related moments ending at the latest one: walks back while related
 * moments are no more than [gapMs] apart (unrelated moments in between don't break it, a long
 * gap does). Null if nothing is related.
 */
export function findStretch(
  items: StretchItem[],
  opts: { gapMs: number; maxMs: number },
): { from: number; to: number } | null {
  const rel = items.filter((i) => i.related).sort((a, b) => b.at - a.at);
  if (!rel.length) return null;
  const to = rel[0].at;
  let from = to;
  for (const it of rel.slice(1)) {
    if (from - it.at > opts.gapMs || to - it.at > opts.maxMs) break;
    from = it.at;
  }
  return { from, to };
}

/** Cosine distances from the vector search → which moments count as related. */
export const RELATED_MARGIN = 0.2;
export const RELATED_MAX = 0.7;

export function relatedIds(distances: Map<number, number>): Set<number> {
  if (!distances.size) return new Set();
  const best = Math.min(...distances.values());
  const limit = Math.min(best + RELATED_MARGIN, RELATED_MAX);
  return new Set([...distances].filter(([, d]) => d <= limit).map(([id]) => id));
}

// --- The prompt ---

export type RecapLine = { at: number; who: string; text: string };
export type RecapNote = { at: number; text: string };
export type RecapExtras = { places?: string[]; seen?: string[]; done?: string[]; due?: string[] };

/** Characters of material given to the model (~1,800 tokens): prefill is the wait on a phone. */
export const RECAP_BUDGET = 7000;
const LINE_CHARS = 160;
const NOTE_CHARS = 400;

const cut = (t: string, n: number) => {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** Lines spread evenly over the range (not just the start) until the budget is used. */
export function sampleLines(lines: RecapLine[], budget: number, stamp: (at: number) => string) {
  const out: string[] = [];
  if (!lines.length || budget <= 0) return out;
  const fmt = (l: RecapLine) => `[${stamp(l.at)}] ${l.who}: ${cut(l.text, LINE_CHARS)}`;
  const avg = Math.max(
    40,
    lines.slice(0, 50).reduce((n, l) => n + fmt(l).length + 1, 0) / Math.min(50, lines.length),
  );
  const n = Math.max(1, Math.min(lines.length, Math.floor(budget / avg)));
  // Evenly from the first line to the last.
  const step = n > 1 ? (lines.length - 1) / (n - 1) : 0;
  let used = 0;
  for (let i = 0; i < n; i++) {
    const line = fmt(lines[Math.round(i * step)]);
    if (used + line.length + 1 > budget) break;
    out.push(line);
    used += line.length + 1;
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * The model prompt: conversation notes first (already summaries), then the extras, then lines
 * spread over the range, all within [RECAP_BUDGET]. Null if there is nothing at all.
 */
export function recapPrompt(
  label: string,
  topic: string | null,
  span: { from: number; to: number },
  notes: RecapNote[],
  lines: RecapLine[],
  extras: RecapExtras = {},
): string | null {
  const multiDay = span.to - span.from > 26 * 3_600_000;
  const stamp = (at: number) =>
    multiDay
      ? `${new Date(at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })} ${hhmm(at)}`
      : hhmm(at);
  const parts: string[] = [];
  let budget = RECAP_BUDGET;
  const add = (s: string) => {
    if (budget <= 0) return;
    const t = s.slice(0, budget);
    parts.push(t);
    budget -= t.length + 1;
  };
  if (notes.length) {
    add('Notes of conversations:');
    const each = Math.max(
      150,
      Math.min(NOTE_CHARS, Math.floor((RECAP_BUDGET * 0.5) / notes.length)),
    );
    for (const n of notes) add(`[${stamp(n.at)}] ${cut(n.text, each)}`);
  }
  const ex: [string, string[] | undefined][] = [
    ['Places', extras.places],
    ['Seen', extras.seen],
    ['To-dos done', extras.done],
    ['Still to do', extras.due],
  ];
  for (const [k, v] of ex) if (v?.length) add(`${k}: ${v.map((x) => cut(x, 120)).join('; ')}`);
  const sampled = sampleLines(lines, budget - 40, stamp);
  if (sampled.length) {
    add('What was said (oldest first; "Me" is me, "Q/A" are my questions to you):');
    for (const l of sampled) add(l);
  }
  if (!notes.length && !sampled.length && !ex.some(([, v]) => v?.length)) return null;
  const about = topic ? ` about ${topic}` : '';
  return `This is what my phone remembers ${label}${about}:
${parts.join('\n')}

Recap ${label}${about} in a few short points: what happened and was talked about, decisions, and anything still to do. Plain words, no preamble. Only what is above.`;
}

/** How a span is said in the answer's first line ("since 14:10", "on Tuesday 17 Nov"). */
export function spanLabel(from: number, to: number, now: number): string {
  const d0 = new Date(now);
  d0.setHours(0, 0, 0, 0);
  if (from >= d0.getTime()) return `since ${hhmm(from)}`;
  const day = new Date(from).toLocaleDateString('en-GB', { weekday: 'long' });
  return new Date(from).toDateString() === new Date(to).toDateString()
    ? `on ${day}, ${hhmm(from)}–${hhmm(to)}`
    : `from ${day} ${hhmm(from)}`;
}

/** Distinct places in the order first visited. */
export function distinctPlaces(places: (string | null)[]): string[] {
  const out: string[] = [];
  for (const p of places) if (p && !out.includes(p)) out.push(p);
  return out.slice(0, 8);
}

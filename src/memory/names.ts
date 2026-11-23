/**
 * Name suggestions from what people say, with no enrolment: "I'm Sam" names the speaking voice,
 * "thanks, Sam" names the person being spoken to. Suggestions are only shown for approval.
 * Pure functions; tested.
 */

export type NameCue = { name: string; who: 'speaker' | 'addressee' };

/** Capitalised words that follow these patterns but are not names. */
const NOT_NAMES = new Set(
  (
    'i you he she it we they me him her us them my your our their this that these those there here ' +
    'everyone everybody guys all folks team mate man dude buddy sir madam mum mom dad love dear ' +
    'darling honey babe sweetie god sure yes yeah no nope ok okay right well so oh just really ' +
    'very not now then again too also good great fine bad sorry thanks thank please hello hi hey ' +
    'bye goodbye morning afternoon evening night today tomorrow yesterday monday tuesday wednesday ' +
    'thursday friday saturday sunday january february march april may june july august september ' +
    'october november december sidekick google siri alexa what when where why how who which ' +
    'going gonna doing coming trying looking getting being having done back home out off over ' +
    'a an the and or but if for of to in on at by with from up down about' +
    ' everything something nothing anything someone somebody nobody anyone a lot lots plenty' +
    " i'm i've i'll i'd it's that's you're we're they're there's don't can't won't let's"
  ).split(' '),
);

const NAME = "([A-Za-z][a-z'-]{1,20})";

const SELF = [
  new RegExp(`\\bmy name(?:'s| is) ${NAME}\\b`, 'i'),
  // "I'm tired." is not a name: only with a greeting before or "nice to meet you" after.
  new RegExp(`\\b(?:hi|hello|hey)[,\\s]+(?:i'm|i am) ${NAME}\\b`, 'i'),
  new RegExp(`\\b(?:i'm|i am) ${NAME}[,.!\\s]+(?:nice|pleased|good) to meet`, 'i'),
  new RegExp(`\\b(?:this is|it's) ${NAME}\\s*(?:speaking|here)\\b`, 'i'),
  new RegExp(`\\bcall me ${NAME}\\b`, 'i'),
];

const ADDRESS = [
  new RegExp(
    `\\b(?:thanks|thank you|cheers|hi|hello|hey|bye|morning|night|sorry)[,\\s]+${NAME}\\s*(?:[,.!?]|$)`,
    'i',
  ),
  new RegExp(
    `^${NAME}\\s*,\\s*(?:can|could|would|will|do|did|are|have|what|where|when|how|why|please|you)\\b`,
    'i',
  ),
  new RegExp(`\\b(?:what do you think|what about you|right|okay|ok)[,\\s]+${NAME}\\s*[?.!]`, 'i'),
];

function clean(word: string): string | null {
  const w = word.toLowerCase();
  if (NOT_NAMES.has(w) || w.length < 2) return null;
  return w[0].toUpperCase() + w.slice(1);
}

/** Finds names in one transcript line. Speech-to-text capitalisation is not trusted. */
export function findNameCues(text: string): NameCue[] {
  const out: NameCue[] = [];
  const t = text.trim();
  for (const re of SELF) {
    const m = t.match(re);
    const n = m && clean(m[1]);
    if (n && !out.some((c) => c.name === n)) out.push({ name: n, who: 'speaker' });
  }
  for (const re of ADDRESS) {
    const m = t.match(re);
    const n = m && clean(m[1]);
    if (n && !out.some((c) => c.name === n)) out.push({ name: n, who: 'addressee' });
  }
  return out;
}

export const ADDRESS_WINDOW_MS = 20_000;

export type Utterance = { at: number; speakerId: number | null; isOwner: boolean };

/**
 * Who a name addressed in [line] refers to: the nearest other non-owner voice that spoke within
 * 20 s (before or after). Null if there is no clear single candidate.
 */
export function addresseeOf(line: Utterance, nearby: Utterance[]): number | null {
  let best: { id: number; gap: number } | null = null;
  const ids = new Set<number>();
  for (const u of nearby) {
    if (u.speakerId == null || u.isOwner || u.speakerId === line.speakerId) continue;
    const gap = Math.abs(u.at - line.at);
    if (gap > ADDRESS_WINDOW_MS) continue;
    ids.add(u.speakerId);
    if (!best || gap < best.gap) best = { id: u.speakerId, gap };
  }
  // Two or more other voices around: "thanks, Sam" could be either; don't guess.
  return ids.size === 1 && best ? best.id : null;
}

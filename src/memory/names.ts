/**
 * Name suggestions from what people say, with no enrolment: "I'm Sam" names the speaking voice,
 * "thanks, Sam" names the person being spoken to. Suggestions are only shown for approval.
 * Pure functions; tested.
 */

/**
 * strong: a clear self-introduction ("my name is Sam", "hi, I'm Sam"), applied to the voice
 * automatically (marked auto, with undo); weak cues only become an "Is this Sam?" suggestion.
 */
export type NameCue = { name: string; who: 'speaker' | 'addressee'; strong: boolean };

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

/** Self-introductions; the flag says whether the cue is strong enough to apply on its own. */
const SELF: [RegExp, boolean][] = [
  [new RegExp(`\\bmy name(?:'s| is) ${NAME}\\b`, 'i'), true],
  // "I'm tired." is not a name: only with a greeting before or "nice to meet you" after.
  [new RegExp(`\\b(?:hi|hello|hey)[,\\s]+(?:i'm|i am) ${NAME}\\b`, 'i'), true],
  [new RegExp(`\\b(?:i'm|i am) ${NAME}[,.!\\s]+(?:nice|pleased|good) to meet`, 'i'), true],
  // "It's Sam here" can be passing on a message; "call me Sam" can be a nickname: suggest only.
  [new RegExp(`\\b(?:this is|it's) ${NAME}\\s*(?:speaking|here)\\b`, 'i'), false],
  [new RegExp(`\\bcall me ${NAME}\\b`, 'i'), false],
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

/** A heard word as a name ("sam" → "Sam"), or null if it is a common word, not a name. */
export function asName(word: string): string | null {
  return clean(word);
}

function clean(word: string): string | null {
  const w = word.toLowerCase();
  if (NOT_NAMES.has(w) || w.length < 2) return null;
  return w[0].toUpperCase() + w.slice(1);
}

/** Finds names in one transcript line. Speech-to-text capitalisation is not trusted. */
export function findNameCues(text: string): NameCue[] {
  const out: NameCue[] = [];
  const t = text.trim();
  for (const [re, strong] of SELF) {
    const m = t.match(re);
    const n = m && clean(m[1]);
    const seen = out.find((c) => c.name === n);
    if (seen) seen.strong ||= strong;
    else if (n) out.push({ name: n, who: 'speaker', strong });
  }
  for (const re of ADDRESS) {
    const m = t.match(re);
    const n = m && clean(m[1]);
    if (n && !out.some((c) => c.name === n)) out.push({ name: n, who: 'addressee', strong: false });
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

// --- Contacts (when the user turns them on) ---

/**
 * A heard first name ("Sam") made specific with the phone's contacts: the full name if exactly
 * one contact has that first name, else the name as heard.
 */
export function fullNameFromContacts(heard: string, contactNames: string[]): string {
  const h = heard.toLowerCase();
  const matches = new Set(
    contactNames.filter((c) => c.trim().split(/\s+/)[0]?.toLowerCase() === h).map((c) => c.trim()),
  );
  return matches.size === 1 ? [...matches][0] : heard;
}

/** Contact names starting with what's been typed (any word), for naming a voice. */
export function contactNameMatches(typed: string, contactNames: string[], limit = 4): string[] {
  const t = typed.trim().toLowerCase();
  if (t.length < 2) return [];
  const out: string[] = [];
  for (const c of contactNames) {
    const name = c.trim();
    if (name.toLowerCase() === t) continue;
    if (
      name
        .toLowerCase()
        .split(/\s+/)
        .some((w, i, ws) => ws.slice(i).join(' ').startsWith(t))
    )
      if (!out.includes(name)) out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

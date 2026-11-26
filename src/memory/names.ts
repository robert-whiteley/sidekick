/**
 * Name suggestions from what people say, with no enrolment: "I'm Sam" names the speaking voice,
 * "thanks, Sam" names the person being spoken to. Suggestions are only shown for approval.
 * Pure functions; tested.
 */

/**
 * strong: a clear self-introduction ("my name is Sam", "hi, I'm Sam"), applied to the voice
 * automatically (marked auto, with undo); weak cues only become an "Is this Sam?" suggestion.
 */
export type NameCue = {
  name: string;
  who: 'speaker' | 'addressee';
  strong: boolean;
  /**
   * Addressee only: the named person is expected to answer ("Sam, can you…", "hi Sam"), so the
   * next voice is theirs; otherwise ("thanks, Sam") it is the voice that just spoke.
   */
  replyExpected?: boolean;
};

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
  [
    new RegExp(
      `\\b(?:hi|hiya|hello|hey)(?: there| all| everyone| guys)?[,\\s]+(?:i'm|i am) ${NAME}\\b`,
      'i',
    ),
    true,
  ],
  [new RegExp(`\\b(?:i'm|i am) ${NAME}[,.!\\s]+(?:nice|pleased|good) to meet`, 'i'), true],
  [new RegExp(`\\b(?:i'm|i am) ${NAME},? by the way\\b`, 'i'), true],
  // "It's Sam here" can be passing on a message; "call me Sam" can be a nickname: suggest only.
  [new RegExp(`\\b(?:this is|it's) ${NAME}\\s*(?:speaking|here)\\b`, 'i'), false],
  [new RegExp(`\\bcall me ${NAME}\\b`, 'i'), false],
  // "And I'm Ruth." after others introduced themselves. Needs the speech model's capital letter
  // ("and I'm late." is not a name) and stays a suggestion ("And I'm English.").
  [new RegExp(`\\b[Aa]nd (?:I'm|I am) ([A-Z][a-z'-]{1,20})\\s*[,.!]`), false],
];

/** Ways of calling someone by name; the flag: whether they are expected to answer. */
const ADDRESS: [RegExp, boolean][] = [
  [
    new RegExp(`\\b(?:thanks|thank you|cheers|bye|night|sorry)[,\\s]+${NAME}\\s*(?:[,.!?]|$)`, 'i'),
    false,
  ],
  [new RegExp(`\\b(?:hi|hello|hey|morning)[,\\s]+${NAME}\\s*(?:[,.!?]|$)`, 'i'), true],
  [
    new RegExp(
      `^${NAME}\\s*,\\s*(?:can|could|would|will|do|did|are|have|what|where|when|how|why|please|you)\\b`,
      'i',
    ),
    true,
  ],
  [
    new RegExp(
      `\\b(?:what do you think|what about you|right|okay|ok|how are you|how about you)[,\\s]+${NAME}\\s*[?.!]`,
      'i',
    ),
    true,
  ],
  // "…, Sam?" at the end of a question.
  [new RegExp(`,\\s*${NAME}\\s*\\?\\s*$`, 'i'), true],
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
  for (const [re, replyExpected] of ADDRESS) {
    const m = t.match(re);
    const n = m && clean(m[1]);
    if (n && !out.some((c) => c.name === n))
      out.push({ name: n, who: 'addressee', strong: false, replyExpected });
  }
  return out;
}

export const ADDRESS_WINDOW_MS = 20_000;

export type Utterance = { at: number; speakerId: number | null; isOwner: boolean };

export const REPLY_WINDOW_MS = 10_000;

/**
 * Who a name addressed in [line] refers to. With [replyExpected] ("Sam, can you…"): the first
 * other voice to speak within 10 s after it, the one answering. Without ("thanks, Sam"): the
 * last other voice within 10 s before it. Otherwise, or if neither is found: the nearest other
 * voice within 20 s, only when it is the only one around. Never the owner or the line's speaker.
 */
export function addresseeOf(
  line: Utterance,
  nearby: Utterance[],
  replyExpected?: boolean,
): number | null {
  const others = nearby
    .filter((u) => u.speakerId != null && !u.isOwner && u.speakerId !== line.speakerId)
    .sort((a, b) => a.at - b.at);
  if (replyExpected === true) {
    const reply = others.find((u) => u.at > line.at && u.at - line.at <= REPLY_WINDOW_MS);
    if (reply) return reply.speakerId;
  } else if (replyExpected === false) {
    const before = others.filter((u) => u.at < line.at && line.at - u.at <= REPLY_WINDOW_MS);
    if (before.length) return before[before.length - 1].speakerId;
  }
  return nearestOnly(line, others);
}

/**
 * Whether a "Sam, can you…" cue can be settled now. Lines are stored one at a time as they are
 * heard, so when the cue's line arrives the answer hasn't been heard yet; it waits until another
 * voice answers or the reply window has passed ([now] is the newest line heard).
 */
export function replySettled(line: Utterance, nearby: Utterance[], now: number): boolean {
  if (now - line.at > REPLY_WINDOW_MS) return true;
  return nearby.some(
    (u) =>
      u.speakerId != null &&
      !u.isOwner &&
      u.speakerId !== line.speakerId &&
      u.at > line.at &&
      u.at - line.at <= REPLY_WINDOW_MS,
  );
}

function nearestOnly(line: Utterance, nearby: Utterance[]): number | null {
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

// --- Names from context (the model reads a whole conversation) ---

export const MAX_NAME_LINES = 30;

/** Several cues for the same name and voice add up; at this much it is applied (auto, undoable). */
export const AUTO_NAME_AT = 3;
/** The model's reading of a whole conversation counts as two cues: one more confirms it. */
export const CONTEXT_WEIGHT = 2;

/**
 * Asks the model who is who in the conversation going on ("Me" is the phone's owner; others by
 * label): first names from context (who answers to a name, who is introduced or spoken to), and
 * otherwise what each person seems to be from what is said ("would you like to order?" → waiter).
 */
export function namePrompt(lines: { who: string; text: string }[]): string {
  return (
    'Here is a conversation my phone is hearing. "Me" is me; the others are labelled Person 1, ' +
    'Person 2 and so on. Work out who each labelled person is from what THEY say and what is ' +
    'said to them. For example, a person who asks "would you like to order?" or brings the food ' +
    'is a waiter, and the person ordering is the customer; a person who says "tickets please" ' +
    'or "next stop" is a bus driver or conductor.\n' +
    'For each labelled person write one line exactly as: label | first name | description\n' +
    'First name: only if it is clear (someone calls them by it, introduces them, or they ' +
    'answer to it), else -.\n' +
    'Description: the most precise thing the conversation shows they are, in 1 to 3 words ' +
    '(waiter, bus driver, doctor, my colleague, shop assistant), or man, woman or child if that ' +
    'is all that is clear, else -. Do not guess.\n\n' +
    lines.map((l) => `${l.who}: ${l.text}`).join('\n')
  );
}

/**
 * Roles that show from what a person says themselves (not what is said to them). They outrank
 * the model's description: the small model sometimes swaps roles (a ticket seller as "customer").
 */
const ROLE_CUES: [RegExp, string][] = [
  [
    /\b(tickets? please|next stop|tap your card|fares?|the number \w+ (leaves|goes|is leaving)|mind the doors|single or return)\b/i,
    'bus driver',
  ],
  [
    /\b(ready to order|would you like to order|take your order|can i get you|any drinks|something to drink|looking after your table|your table|for starters|your starters|dessert menu|enjoy your meal|need a (few|couple of) (more )?minutes)\b/i,
    'waiter',
  ],
  [
    // Loose on purpose: speech-to-text drops words ("You need a bag?", "Card were cash").
    /\b(need a bag|like a bag|next customer|card or cash|cash or card|(your|a) receipt|is that everything)\b/i,
    'shop assistant',
  ],
  [/\b(what seems to be the problem|any allergies to medication|take a deep breath)\b/i, 'doctor'],
];

/** The role a person's own lines show, or null. The role with the most cues wins. */
export function roleFromLines(lines: string[]): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [re, role] of ROLE_CUES) {
    const n = lines.filter((l) => re.test(l)).length;
    if (n > bestN) {
      best = role;
      bestN = n;
    }
  }
  return best;
}

export type WhoGuess = { label: string; name: string | null; description: string | null };

const NOT_DESCRIPTIONS = new Set([
  '-',
  'none',
  'unknown',
  'n/a',
  'unclear',
  'person',
  'speaker',
  'someone',
  'me',
  'i',
]);

/**
 * The model's "Person 3 | Sam | waiter" lines, kept only for labels in [labels]. A name only if
 * it is a real name that was said in [heard] (nothing invented) and no one else got it; a
 * description only if short and plain.
 */
export function parseWhoGuesses(text: string, labels: string[], heard: string): WhoGuess[] {
  const said = new Set(heard.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []);
  const out: WhoGuess[] = [];
  for (const raw of text.split('\n')) {
    const parts = raw
      .replace(/^\s*[-*]\s*/, '')
      .split('|')
      .map((x) => x.trim());
    if (parts.length < 2) continue;
    const label = labels.find((l) => l.toLowerCase() === parts[0].toLowerCase());
    if (!label || out.some((g) => g.label === label)) continue;
    let name = /^[A-Za-z][A-Za-z'-]+$/.test(parts[1]) ? clean(parts[1]) : null;
    if (name && (!said.has(name.toLowerCase()) || out.some((g) => g.name === name))) name = null;
    const d = (parts[2] ?? '')
      .toLowerCase()
      .replace(/[.!]+$/, '')
      .trim();
    const description =
      /^[a-z][a-z' -]{1,29}$/.test(d) && d.split(/\s+/).length <= 3 && !NOT_DESCRIPTIONS.has(d)
        ? d
        : null;
    if (name || description) out.push({ label, name, description });
  }
  return out;
}

/** A suggestion's new evidence count, and whether it is now enough to apply the name. */
export function addEvidence(
  current: { name: string | null; count: number },
  name: string,
  weight: number,
): { name: string; count: number; apply: boolean } | null {
  let count: number;
  if (current.name === name) count = current.count + weight;
  // A different name replaces a guess only with at least as much evidence.
  else if (!current.name || current.count <= weight) count = weight;
  else return null;
  return { name, count, apply: count >= AUTO_NAME_AT };
}

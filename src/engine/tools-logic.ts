/**
 * The tool catalog: every capability Sidekick has, described once with a small argument schema,
 * so the model can pick one (with arguments) for requests the fast rules don't recognise. The
 * rules still run first (instant on a Pixel 5); this is the fallback that makes any phrasing work.
 *
 * Pure (prompt, parsing, validation, relevance); the handlers live in tools.ts. Tested in
 * __tests__/tools-router-test.ts.
 *
 * Format: strict JSON in a throwaway chat, not LiteRT-LM's native tool calling. The native API
 * runs Kotlin-annotated tools inside the engine; ours are JS handlers behind draft cards and
 * read-back, and the same prompt works on every backend and for the iPhone later.
 */

export type ArgType = 'string' | 'number' | 'boolean' | 'datetime';

export type ArgSpec = {
  type: ArgType;
  /** A few words for the model. */
  desc?: string;
  required?: boolean;
  /** Allowed values (strings only). */
  values?: string[];
  min?: number;
  max?: number;
};

/**
 * info: returns text that answers or feeds the next step of a chain. action: does something
 * through the usual paths (draft card, read-back, countdown). answer: the normal answer path.
 */
export type ToolKind = 'info' | 'action' | 'answer';

export type ToolSpec = {
  name: string;
  desc: string;
  kind: ToolKind;
  args: Record<string, ArgSpec>;
  /**
   * Words that make this tool worth offering for a request. Only narrows the list in the prompt
   * (each tool line costs prompt reading time on a slow phone); the model still decides.
   */
  words: RegExp;
};

const s = (desc?: string, required = false): ArgSpec => ({ type: 'string', desc, required });
const req = (desc?: string): ArgSpec => s(desc, true);
const oneOf = (values: string[], required = false): ArgSpec => ({
  type: 'string',
  values,
  required,
});
const bool = (required = true): ArgSpec => ({ type: 'boolean', required });
const num = (min: number, max: number, required = false, desc?: string): ArgSpec => ({
  type: 'number',
  min,
  max,
  required,
  desc,
});
const when = (desc: string): ArgSpec => ({ type: 'datetime', desc });

export const TOOLS: ToolSpec[] = [
  {
    name: 'memory_search',
    desc: 'what I saw, heard, said, was told, or have in notes, calendar, contacts or files',
    kind: 'answer',
    args: {
      query: s('what to look for'),
      from: when('start, if a time is meant'),
      to: when('end'),
      person: s('who'),
      place: s('where'),
    },
    words:
      /\b(remember|said|say|told|tell me about|saw|seen|see|heard|mention|talk|discuss|meeting|appointment|calendar|note|when (did|was)|last time|earlier|ago|yesterday|week|month)\b/,
  },
  {
    name: 'recap',
    desc: 'summary of a time span or of a topic from memory',
    kind: 'answer',
    args: { from: when('start'), to: when('end'), topic: s('topic, if any') },
    words: /\b(recap|summar|sum up|catch me up|overview|digest|what happened|been (doing|up to))\b/,
  },
  {
    name: 'message',
    desc: 'send a text/WhatsApp/Telegram/Signal message',
    kind: 'action',
    args: {
      to: req('person'),
      text: req('message, written as me'),
      app: oneOf(['whatsapp', 'sms', 'telegram', 'signal', 'auto']),
    },
    words:
      // "tell me …" is a request to Sidekick, never a message (that needs someone else).
      /\b(text|message|whatsapp|telegram|signal|sms|tell (?!me\b|us\b)|let .+ know|ask (him|her|them|\w+) |reply|send)\b/,
  },
  {
    name: 'email',
    desc: 'send an email',
    kind: 'action',
    args: { to: req('person or address'), subject: s(), body: req('email text') },
    words: /\b(e-?mail|mail|write to|send)\b/,
  },
  {
    name: 'call',
    desc: 'phone someone',
    kind: 'action',
    args: { to: req('person or number') },
    words: /\b(call|ring|dial)\b|^ phone\b|\bphone (him|her|them|mum|mom|dad|back|home|work)\b/,
  },
  {
    name: 'event',
    desc: 'add a calendar event',
    kind: 'action',
    args: { title: req(), when: req('time words, e.g. Friday at 3pm'), place: s() },
    words: /\b(calendar|diary|schedule|book|appointment|meeting|event|lunch|dinner|plan)\b/,
  },
  {
    name: 'reminder',
    desc: 'remind me later, or add a to-do',
    kind: 'action',
    args: { what: req('what to do'), when: s('time words, or empty for a to-do') },
    words: /\b(remind|reminder|to-?do|don't let me forget|nudge|todo|task|ping me)\b/,
  },
  {
    name: 'routine',
    desc: 'do an instruction later (once) or repeat it on a schedule or when something happens',
    kind: 'action',
    args: {
      when: req('e.g. in 10 minutes, at 5pm, every day at 6pm, whenever Sam messages me'),
      instruction: req('what to do then'),
    },
    words:
      /\b(every|each (day|morning|evening|night|week|month|hour|time|sunday|monday|tuesday|wednesday|thursday|friday|saturday)|whenever|daily|weekly|routine|any time|in (\d+|an?|one|two|three|five|ten|fifteen|twenty|thirty|half an) (minutes?|mins?|hours?|hrs?|hour))\b/,
  },
  {
    name: 'alarm',
    desc: 'set an alarm',
    kind: 'action',
    args: { time: req('HH:MM, 24-hour'), label: s() },
    words: /\b(alarm|wake me)\b/,
  },
  {
    name: 'timer',
    desc: 'start a countdown timer',
    kind: 'action',
    args: { minutes: num(0.1, 1440, true), label: s() },
    words:
      /\b(timer|countdown|count down|minutes|seconds|quarter of an hour|half an hour|give me a shout|shout)\b/,
  },
  {
    name: 'navigate',
    desc: 'start turn-by-turn directions',
    kind: 'action',
    args: {
      destination: req(),
      mode: oneOf(['driving', 'walking', 'transit', 'cycling']),
    },
    words:
      /\b(navigate|directions|take me|get me to|drive|route|way to|how do i get|walk to|go to)\b/,
  },
  {
    name: 'ride',
    desc: 'order a taxi/ride',
    kind: 'action',
    args: { destination: s(), app: oneOf(['uber', 'bolt', 'lyft', 'freenow']) },
    words: /\b(taxi|cab|uber|bolt|lyft|freenow|ride|lift)\b/,
  },
  {
    name: 'app_search',
    desc: 'search inside an app or the web',
    kind: 'action',
    args: {
      app: oneOf(
        ['youtube', 'spotify', 'amazon', 'playstore', 'maps', 'google', 'web', 'waze'],
        true,
      ),
      query: req(),
    },
    words: /\b(search|find|youtube|spotify|amazon|play store|google|browse|shop|buy|video)\b/,
  },
  {
    name: 'play',
    desc: 'play music, a podcast or a video',
    kind: 'action',
    args: { query: req(), app: s('app name, if said') },
    words: /\b(play|listen to|put on|music|song|album|podcast|playlist)\b/,
  },
  {
    name: 'media',
    desc: 'control what is playing',
    kind: 'action',
    args: { command: oneOf(['play', 'pause', 'next', 'previous', 'stop'], true) },
    words: /\b(pause|resume|skip|next|previous|stop|track|song|music)\b/,
  },
  {
    name: 'open_app',
    desc: 'open an app',
    kind: 'action',
    args: { name: req('app name') },
    words: /\b(open|launch|start|go to|show me)\b/,
  },
  {
    name: 'phone_setting',
    desc: 'torch, volume, do not disturb, brightness, or open the wifi/bluetooth/airplane switch',
    kind: 'action',
    args: {
      setting: oneOf(
        [
          'torch',
          'volume',
          'dnd',
          'brightness',
          'wifi',
          'bluetooth',
          'airplane',
          'internet',
          'nfc',
        ],
        true,
      ),
      on: bool(false),
      level: num(0, 100, false, 'percent'),
      change: oneOf(['up', 'down', 'mute', 'unmute', 'max', 'auto']),
    },
    words:
      /\b(torch|flashlight|light|volume|louder|quieter|loud|quiet|mute|silent|disturb|dnd|brightness|bright|dim|dark|wi-?fi|bluetooth|airplane|aeroplane|flight mode|nfc|data)\b/,
  },
  {
    name: 'phone_info',
    desc: 'battery, storage, steps, screen time, or what I copied',
    kind: 'info',
    args: {
      what: oneOf(['battery', 'storage', 'steps', 'screen_time', 'clipboard'], true),
      day: oneOf(['today', 'yesterday', 'week']),
      app: s('app, for screen time'),
    },
    words:
      /\b(battery|charge|charging|storage|space|memory full|steps|walked|screen time|on my phone for|clipboard|copied)\b/,
  },
  {
    name: 'birthdays',
    desc: 'birthdays from contacts',
    kind: 'info',
    args: { name: s(), within: oneOf(['next', 'week', 'month']) },
    words: /\b(birthday|born|turning|how old)\b/,
  },
  {
    name: 'weather',
    desc: 'weather forecast',
    kind: 'info',
    args: { place: s('town, or empty for here'), day: s('e.g. today, tomorrow, Saturday') },
    words:
      /\b(weather|rain|raining|sunny|snow|cold|hot|warm|temperature|forecast|umbrella|coat|wind|windy|degrees)\b/,
  },
  {
    name: 'location',
    desc: 'where I am, was, parked, or how long I stayed somewhere',
    kind: 'info',
    args: {
      question: oneOf(
        ['where_now', 'where_was', 'parked', 'last_visit', 'time_at', 'visited'],
        true,
      ),
      place: s(),
      when: s('time words, for where_was / time_at / visited'),
    },
    words:
      /\b(where am i|where was i|where were we|park|parked|car|been|visit|visited|place|here|location|how long was i)\b/,
  },
  {
    name: 'name_place',
    desc: 'name the place I am at',
    kind: 'action',
    args: { name: req() },
    words: /\b(call this place|this is (my )?(home|work|office|gym)|name (this|here)|this place)\b/,
  },
  {
    name: 'watch',
    desc: 'tell me when the camera sees something',
    kind: 'action',
    args: { thing: req(), every: bool(false) },
    words: /\b(when you see|look out|watch|keep an eye|spot|let me know if you see)\b/,
  },
  {
    name: 'stop_watching',
    desc: 'stop a camera watch',
    kind: 'action',
    args: { thing: s() },
    words: /\b(stop (watching|looking)|don't watch|no longer)\b/,
  },
  {
    name: 'find_phone',
    desc: 'ring this phone loudly',
    kind: 'action',
    args: {},
    words: /\b(find my phone|lost my phone|where is my phone|ring my phone)\b/,
  },
  {
    name: 'speech_speed',
    desc: 'change how fast you speak',
    kind: 'action',
    args: { change: oneOf(['faster', 'slower', 'normal']), percent: num(50, 200) },
    words:
      /\b((speak|talk)(ing)? (a bit |a little )?(more )?(slow|slower|slowly|faster|quicker|quickly|up)|speed|slower|faster|slow down|speed up|quicker)\b/,
  },
  {
    name: 'listening',
    desc: 'start or stop background listening',
    kind: 'action',
    args: { on: bool() },
    words: /\b(listen|listening|mic|microphone|hear)\b/,
  },
  {
    name: 'camera',
    desc: 'turn the live camera on or off',
    kind: 'action',
    args: { on: bool() },
    words: /\b(camera|video|recording)\b/,
  },
  {
    name: 'camera_setting',
    desc: 'change the live camera: frame rate, front or back camera, image detail / resolution',
    kind: 'action',
    args: {
      frames: s('frame rate: more, fewer, normal, or a number per second'),
      lens: oneOf(['front', 'back', 'flip']),
      detail: oneOf(['low', 'medium', 'high', 'higher', 'lower', 'normal']),
    },
    words:
      /\b(camera|frames?|fps|frame rate|front|back|rear|selfie|flip|resolution|detail|quality|sharper|clearer|hd|720p?|1080p?|480p?)\b/,
  },
  {
    name: 'feedback',
    desc: 'send feedback about Sidekick to its makers',
    kind: 'action',
    args: { text: req('the feedback, as said') },
    words: /\b(feedback|bug|suggestion|complain|developer|makers|report a problem)\b/,
  },
  {
    name: 'reply',
    desc: 'answer with this text (after using results)',
    kind: 'answer',
    args: { text: req() },
    words: /$^/,
  },
];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/**
 * Tools never offered to a routine run: a routine's question can carry outside text (an incoming
 * message), so nothing that acts at once on the phone is allowed — only answers and draft cards.
 */
export const NOT_IN_ROUTINES = new Set([
  'routine',
  'alarm',
  'timer',
  'navigate',
  'ride',
  'app_search',
  'play',
  'media',
  'open_app',
  'phone_setting',
  'name_place',
  'watch',
  'stop_watching',
  'find_phone',
  'speech_speed',
  'listening',
  'camera',
  'camera_setting',
]);
export const NOT_OFF_RECORD = new Set(['routine', 'name_place']);

const norm = (q: string) =>
  ` ${q
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;

const QUESTION_START =
  /^((at|in|on|for|by|from|to|of|until|till|since) (what|which|whom|how|when)|what|who|whom|whose|where|when|why|how|is|are|am|do|does|did|was|were|which|can i|could i|should|would|will|have|has|had)\b/;

/**
 * The part of [q] that is asked: the last sentence, without a leading "if …," ("Tom is taller
 * than Sam. Who is the shortest?" → "who is the shortest").
 */
function askedPart(q: string): string {
  const parts = q
    .toLowerCase()
    .split(/[.?!]+\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return norm(
    last.replace(/^(so|and|then|ok|okay|now)\b,? ?/, '').replace(/^if [^,]{1,80}, ?/, ''),
  ).trim();
}

/** A question (its asked part starts with a question word), not a request. */
export function looksQuestion(q: string): boolean {
  return QUESTION_START.test(askedPart(q));
}

/** An instruction ("text…", "turn…", "book…"), not a question. */
export function looksImperative(q: string): boolean {
  const s = norm(q).trim();
  if (QUESTION_START.test(s) || looksQuestion(q)) return false;
  return s.split(' ').length >= 2;
}

/**
 * Requests for words, not actions: jokes, poems, tips, explanations. Answered by the model
 * directly unless an action word is in them too ("in one minute, tell me a fun fact").
 */
const GENERATIVE =
  /^(?:please )?(?:(?:can|could|would) you )?(tell me (?:a |an |some |another |one more )?(?:joke|story|fun fact|fact|riddle|poem|bit)s?\b|tell me (?:about|something)\b|(?:write|compose|make up|draft me) (?:me )?(?:a |an |some )?(?:short |little |funny )?(?:poem|story|limerick|haiku|song|joke|riddle|paragraph|essay|speech|toast)|give me (?:\d+|a|an|some|one|two|three|four|five|a few|ten) (?:\w+ )?(?:tips|ideas|reasons|ways|examples|facts|suggestions|names|words|synonyms)\b|explain\b|describe\b|define\b|summari[sz]e (?:the|this|what) (?:idea|concept|theory|history|plot)|suggest\b|recommend\b|look up\b|find out\b|list (?:\d+|some|a few|the)\b)/;

/** Opinions and remarks ("I love the camera on this phone", "thanks"): nothing to do. */
const REMARK =
  /^(i (really |just |do )?(love|like|hate|enjoy|adore|dislike|liked|loved|hated)|that's|that was|it's (so|really|very|quite|too)|you're|you are|thanks|thank you|nice|cool|great|wow)\b/;

/** Temperature words in science, cooking or health, not the weather. */
const SCIENCE =
  /\b(celsius|fahrenheit|kelvin|boil|boils|boiling|freeze|freezes|freezing point|melt|melts|oven|bake|body|fever|absolute zero)\b/;

/** "What did I buy Kofi for his birthday?": a memory, not the contacts' birthdays. */
const GIFT =
  /\b(buy|bought|get|got|give|gave|make|made|send|sent) .*\bfor (his|her|their|your|my|the) birthday\b/;

/** "How much does the plumber charge?": a price, not the battery. */
const PRICE = /\b(how much|what) (do|does|did|will|would)\b.*\bcharge\b/;

/** "Where did I leave my umbrella?": a lost thing, not the forecast. */
const LOST_THING = /\b(where|left|leave|lost|find|found)\b.*\b(umbrella|coat)\b/;

/** Sending or calling "me": there's no one to send to; the model answers instead. */
const SELF_SEND =
  /\b(text|message|msg|whatsapp|e-?mail|mail|call|ring|phone|send|ping) (me|myself|us)\b(?! (back|later|when|if|at|in|on|tomorrow|tonight))/;
const SELF_SEND_TOOLS = new Set(['message', 'email', 'call']);

/** Questions about general knowledge, opinions, or the scene: the plain answer path is best. */
const PLAIN =
  /^(what is|what are|what's|who is|who was|who are|why|explain|define|tell me (a joke|about (the|a|an) )|how (do|does|did|can|could|would|should) (you|i|we|it|they|people|a|an|the) (make|cook|work|fix|say|spell|pronounce|learn|become))\b/;

/** Asks for text to be written or said: answered by the model, not a tool. */
const ASKS_FOR_WORDS =
  /^(give me|tell me|write|rewrite|list|suggest|explain|describe|summari[sz]e|shorten|translate|name|make it|make (me )?(a|an|up)|another|compose|come up with|think of|recommend|teach me|show me how|help me (write|think|plan|choose|decide))\b/;

/**
 * The tools worth offering for [q], most relevant first, at most [max]; empty when the request is
 * plainly informational or no tool fits. `reply` is never offered first (only in chains).
 */
export function relevantTools(
  q: string,
  opts: { routine?: boolean; offRecord?: boolean; max?: number } = {},
): ToolSpec[] {
  const s = norm(q);
  const usable = TOOLS.filter(
    (t) =>
      t.name !== 'reply' &&
      !(opts.routine && NOT_IN_ROUTINES.has(t.name)) &&
      !(opts.offRecord && NOT_OFF_RECORD.has(t.name)),
  );
  const question = looksQuestion(q);
  const selfSend = SELF_SEND.test(s);
  const hits = usable.filter(
    (t) =>
      t.words.test(s) &&
      !(t.name === 'weather' && (SCIENCE.test(s) || LOST_THING.test(s))) &&
      !(t.name === 'phone_info' && PRICE.test(s)) &&
      !(t.name === 'birthdays' && GIFT.test(s)) &&
      // A question asks for an answer: "what language do people speak", "how many minutes in
      // 3 hours" mustn't offer speech speed or timers. Requests ("can you…") aren't questions.
      !(question && t.kind === 'action') &&
      !(selfSend && SELF_SEND_TOOLS.has(t.name)),
  );
  const imperative = looksImperative(q);
  const t0 = s.trim();
  // A plain knowledge question with nothing but memory words in it: answer normally.
  const onlyMemory = hits.every((t) => t.kind === 'answer');
  if (!imperative && (PLAIN.test(t0) || onlyMemory)) return [];
  // Jokes, poems, tips, explanations, remarks, "text me a joke": nothing to act on.
  if (onlyMemory && (GENERATIVE.test(t0) || selfSend)) return [];
  if (REMARK.test(t0)) return [];
  if (!hits.length) {
    // An instruction no rule knew and no word points at: offer everything (slower, rare). Not
    // for a request for words ("give me a recipe for pancakes", "write one about autumn"): that
    // is an answer, and offering every action let Gemma open a web search in the browser for it
    // (Pixel 5, 26 Nov), besides ~15 s of routing over 30 tools on each such turn.
    if (!imperative || ASKS_FOR_WORDS.test(s.trim())) return [];
    return usable.slice(0, opts.max ?? usable.length);
  }
  // Memory search stays available: a request that matched an action word may still be a recall.
  const memory = usable.find((t) => t.name === 'memory_search');
  const list = [
    ...hits.filter((t) => t.kind !== 'answer'),
    ...hits.filter((t) => t.kind === 'answer'),
  ];
  if (memory && !list.includes(memory)) list.push(memory);
  return list.slice(0, opts.max ?? 10);
}

function argLine(name: string, a: ArgSpec): string {
  const opt = a.required ? '' : '?';
  const type = a.values ? a.values.join('|') : a.type === 'datetime' ? 'YYYY-MM-DDTHH:MM' : a.type;
  return `${name}${opt}: ${type}${a.desc ? ` (${a.desc})` : ''}`;
}

/** One compact line per tool. */
export function catalogText(tools: ToolSpec[]): string {
  return tools
    .map((t) => {
      const args = Object.entries(t.args).map(([n, a]) => argLine(n, a));
      return `${t.name}(${args.join(', ')}): ${t.desc}`;
    })
    .join('\n');
}

export const ROUTER_SYSTEM =
  "You pick the phone assistant's tool for a request. Reply with one JSON object only, no other text.";

export type ToolStep = { tool: string; args: Record<string, unknown>; result: string };

const two = (n: number) => String(n).padStart(2, '0');
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The router prompt: the request, the offered tools, and the results of earlier steps. */
export function routerPrompt(
  question: string,
  now: Date,
  tools: ToolSpec[],
  steps: ToolStep[] = [],
): string {
  const list = steps.length ? [...tools, toolByName('reply')!] : tools;
  const done = steps.length
    ? `\nDone so far:\n${steps.map((x) => `${x.tool} ${JSON.stringify(x.args)} → ${x.result.slice(0, 400)}`).join('\n')}\n` +
      'Use these results: call the next tool, or reply with the answer.\n'
    : '';
  return `Now: ${now.toDateString()} ${localIso(now).slice(11)}.
Request: ${JSON.stringify(question)}

Tools:
${catalogText(list)}
${done}
Reply {"tool":"<name>","args":{...}} with only the arguments that were said or follow from the request, or {"tool":"none"} if no tool fits (then I answer normally).`;
}

export type ToolCall = { tool: string; args: Record<string, unknown> };

/** The model's reply → a tool call, {tool:'none'}, or null (not JSON). */
export function parseToolReply(reply: string): ToolCall | null {
  const json = /\{[\s\S]*\}/.exec(reply.replace(/```(?:json)?/g, ''))?.[0];
  if (!json) return null;
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const tool =
    typeof r.tool === 'string' ? r.tool.trim() : typeof r.name === 'string' ? r.name : '';
  if (!tool) return null;
  const args = r.args ?? r.arguments ?? r.parameters ?? {};
  return { tool, args: args && typeof args === 'object' ? (args as Record<string, unknown>) : {} };
}

/** "2026-11-25T14:30" (or with seconds / a date only) as local time, or null. */
export function parseLocalIso(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?/.exec(v.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return Number.isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1 ? null : d.getTime();
}

export type Validated = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

/**
 * Checks a call against its schema: known tool, required arguments present, types and values
 * right. Unknown arguments are dropped; empty strings count as missing.
 */
export function validateCall(call: ToolCall, tools: ToolSpec[] = TOOLS): Validated {
  const spec = tools.find((t) => t.name === call.tool);
  if (!spec) return { ok: false, error: `unknown tool ${call.tool}` };
  const out: Record<string, unknown> = {};
  for (const [name, a] of Object.entries(spec.args)) {
    let v = call.args[name];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === null || v === undefined) {
      if (a.required) return { ok: false, error: `${name} missing` };
      continue;
    }
    switch (a.type) {
      case 'string':
        if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
        if (typeof v !== 'string') {
          if (a.required) return { ok: false, error: `${name} not text` };
          continue;
        }
        if (a.values) {
          const lower = v.toLowerCase();
          if (!a.values.includes(lower)) {
            if (a.required) return { ok: false, error: `${name} not one of ${a.values.join('|')}` };
            continue;
          }
          v = lower;
        }
        if ((v as string).length > 500) v = (v as string).slice(0, 500);
        break;
      case 'number': {
        const n = typeof v === 'string' ? Number(v.replace(/%$/, '')) : v;
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          if (a.required) return { ok: false, error: `${name} not a number` };
          continue;
        }
        if ((a.min !== undefined && n < a.min) || (a.max !== undefined && n > a.max)) {
          if (a.required) return { ok: false, error: `${name} out of range` };
          continue;
        }
        v = n;
        break;
      }
      case 'boolean':
        if (typeof v === 'string') {
          if (/^(true|yes|on|1)$/i.test(v)) v = true;
          else if (/^(false|no|off|0)$/i.test(v)) v = false;
        }
        if (typeof v !== 'boolean') {
          if (a.required) return { ok: false, error: `${name} not true/false` };
          continue;
        }
        break;
      case 'datetime': {
        if (typeof v !== 'string') {
          if (a.required) return { ok: false, error: `${name} not a time` };
          continue;
        }
        const t = parseLocalIso(v);
        if (t === null) {
          if (a.required) return { ok: false, error: `${name} not a time` };
          continue;
        }
        v = t;
        break;
      }
    }
    out[name] = v;
  }
  // A message to the user themselves is a mix-up ("tell me a fact"): answer instead.
  if (
    (call.tool === 'message' || call.tool === 'email' || call.tool === 'call') &&
    typeof out.to === 'string' &&
    /^(me|myself|us|i|user|the user)$/i.test(out.to)
  )
    return { ok: false, error: 'to is the user' };
  return { ok: true, args: out };
}

/** A request that needs one result to do the next thing ("text Sam when my dentist is"). */
export function isCompound(q: string): boolean {
  const s = norm(q);
  return (
    /\b(and then|then|after that)\b/.test(s) ||
    /\b(text|message|email|tell|send|remind|let) .{0,30}\b(what|when|where|how much|how many|my|the)\b/.test(
      s,
    ) ||
    /\b(and (text|tell|email|send|message|remind|add|call))\b/.test(s)
  );
}

export const MAX_TOOL_STEPS = 3;

// --- Time ranges the rules can't read ---

/** A question about the past (only then is a span worth a model pass). */
const PAST =
  /\b(did|was|were|had|said|told|saw|seen|heard|went|met|talked|spoke|ago|last|since|earlier|previous|before|over|during|recap|summari[sz]e|happened)\b/;
/** Time words; the rules already read the common ones, so these are the unusual phrasings. */
const TIME_HINT =
  /\b(christmas|easter|new year|halloween|bank holiday|holidays?|half term|birthday|anniversary|fortnight|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|\d{1,2}(st|nd|rd|th)|o'?clock|noon|midnight|morning|afternoon|evening|night|week|month|year|the other day|when i was|first thing|day before)\b/;

/** Requests that are instructions about the future, not questions about a past span. */
const FUTURE_ACTION =
  /^(remind|text|message|email|e-mail|call|ring|set|add|book|schedule|put|every|whenever|at |on |tomorrow|next|in \d|wake|start|turn|play|navigate|take me|order|tell .+ (that|i))/;

/**
 * Has time words the rules couldn't turn into a range ([ruleRange] null), in a question about
 * the past: worth asking the model for from/to.
 */
export function wantsModelRange(q: string, ruleRange: unknown): boolean {
  if (ruleRange) return false;
  const s = norm(q).trim();
  if (FUTURE_ACTION.test(s)) return false;
  return PAST.test(` ${s} `) && TIME_HINT.test(` ${s} `);
}

export function rangePrompt(question: string, now: Date): string {
  return `Now: ${now.toDateString()}, ${localIso(now)}.
Question: ${JSON.stringify(question)}

Which past time span does the question mean? Reply with one JSON object only:
{"from":"YYYY-MM-DDTHH:MM","to":"YYYY-MM-DDTHH:MM","label":"<the span in 2-5 words>"}
or {"none":true} if it names no time span.`;
}

/**
 * The model's span, checked: real times, from before to, not in the future (to is clipped to
 * now), and within the last 10 years. Null if not usable.
 */
export function parseRangeReply(
  reply: string,
  now: Date,
): { from: number; to: number; label: string } | null {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0];
  if (!json) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (o.none || typeof o.from !== 'string' || typeof o.to !== 'string') return null;
  const from = parseLocalIso(o.from);
  let to = parseLocalIso(o.to);
  if (from === null || to === null) return null;
  const t = now.getTime();
  if (to === from && !/T\d/.test(o.to)) to = from + 86_400_000; // a whole day given as dates
  to = Math.min(to, t);
  if (from >= to || from < t - 10 * 365 * 86_400_000) return null;
  const label =
    typeof o.label === 'string' && o.label.trim() && o.label.length <= 40
      ? o.label.trim()
      : 'that time';
  return { from, to, label };
}

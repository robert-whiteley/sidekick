/**
 * The tool catalog: every capability Sidekick has, described once with a small argument schema.
 * The model picks one for a request in any wording (decide.ts), fills its arguments, and they are
 * checked here before tools.ts runs it. No word lists choose a tool.
 *
 * Pure (prompts, parsing, validation); the handlers live in tools.ts. Tested in
 * __tests__/tools-router-test.ts.
 *
 * Format: strict JSON in a throwaway chat, not LiteRT-LM's native tool calling. The native API
 * runs Kotlin-annotated tools inside the engine; ours are JS handlers behind draft cards and
 * read-back, and the same prompt works on every backend and on the iPhone.
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

export const EDIT_OPS = [
  'rotate',
  'flip',
  'crop',
  'grayscale',
  'enhance',
  'background',
  'erase',
  'upscale',
] as const;
export type EditOp = (typeof EDIT_OPS)[number];

/** Offered only while a photo comes with the request (decide.ts); the edit is photo-edit.ts. */
export const EDIT_TOOL: ToolSpec = {
  name: 'edit_photo',
  desc:
    'change the photo: rotate (degrees 90 = clockwise, -90, 180), flip (mirror), crop to a ' +
    'shape, grayscale (black and white), enhance (brighter, clearer colours), background ' +
    '(remove, white, a colour, or blur), erase (remove an object or person from the photo), ' +
    'upscale (make it bigger and sharper)',
  kind: 'action',
  args: {
    op: { type: 'string', values: [...EDIT_OPS], required: true },
    degrees: { type: 'number', min: -270, max: 270 },
    direction: { type: 'string', values: ['horizontal', 'vertical'] },
    shape: { type: 'string', values: ['square', '4:3', '3:4', '16:9', '9:16', 'tighter'] },
    mode: { type: 'string', values: ['remove', 'white', 'color', 'blur'] },
    color: { type: 'string', desc: 'colour name, for mode color' },
  },
};

/**
 * Offered only once the picture model is downloaded (decide.ts); drawn on the phone (picture.ts).
 */
export const PICTURE_TOOL: ToolSpec = {
  name: 'make_picture',
  desc: 'draw, paint or generate a new picture or image of something',
  kind: 'info',
  args: {
    prompt: req('what to draw, in English, with style words (photo, cartoon, watercolour…)'),
  },
};

export const TOOLS: ToolSpec[] = [
  EDIT_TOOL,
  PICTURE_TOOL,
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
  },
  {
    name: 'recap',
    desc: 'summary of a time span or of a topic from memory',
    kind: 'answer',
    args: { from: when('start'), to: when('end'), topic: s('topic, if any') },
  },
  {
    name: 'research',
    desc: 'research a topic online in several searches and write a short report with sources',
    kind: 'info',
    args: {
      topic: req('what to research, as asked'),
      news: { type: 'boolean', desc: 'true if about recent news or events' },
    },
  },
  {
    name: 'message',
    desc: 'send someone a text/WhatsApp/Telegram/Signal message',
    kind: 'action',
    args: {
      to: req('person'),
      text: req('message, written as me'),
      app: oneOf(['whatsapp', 'sms', 'telegram', 'signal', 'auto']),
      at: s('time words, only if I said when to send it'),
    },
  },
  {
    name: 'email',
    desc: 'send an email',
    kind: 'action',
    args: {
      to: req('person or address'),
      subject: s(),
      body: req('email text'),
      at: s('time words, only if I said when to send it'),
    },
  },
  {
    name: 'call',
    desc: 'phone someone',
    kind: 'action',
    args: { to: req('person or number') },
  },
  {
    name: 'draft',
    desc: 'send or cancel the message/email draft waiting in the chat',
    kind: 'action',
    args: { do: oneOf(['send', 'cancel'], true) },
  },
  {
    name: 'reply_message',
    desc: 'reply to a chat message I got (the one just read out, or from someone)',
    kind: 'action',
    args: { text: req('reply, written as me'), to: s('person, if said') },
  },
  {
    name: 'read_messages',
    desc: 'read out my recent chat messages (WhatsApp and other apps), all or from someone',
    kind: 'info',
    args: { from: s('person, as said') },
  },
  {
    name: 'clipboard',
    desc: 'a request about the text I copied (the clipboard): summarise, translate, explain it',
    kind: 'info',
    args: {},
  },
  {
    name: 'move_event',
    desc: 'move one of my calendar events to a new time',
    kind: 'action',
    args: { event: req('which event, as said'), to: req('the new time words') },
  },
  {
    name: 'texts',
    desc: 'read out my text messages (SMS): new ones, the last one, or those from someone',
    kind: 'info',
    args: {
      from: s('person, as said'),
      last: bool(false),
      unread: bool(false),
      when: s('time words'),
    },
  },
  {
    name: 'calls',
    desc: 'who phoned me: missed calls and call history',
    kind: 'info',
    args: { from: s('person, as said'), missed: bool(false), when: s('time words') },
  },
  {
    name: 'call_back',
    desc: 'phone back whoever called me last',
    kind: 'action',
    args: {},
  },
  {
    name: 'event',
    desc: 'add a calendar event',
    kind: 'action',
    args: { title: req(), when: req('time words, e.g. Friday at 3pm'), place: s() },
  },
  {
    name: 'reminder',
    desc: 'a reminder notification with a message at a time, or a to-do (not an alarm sound)',
    kind: 'action',
    args: { what: req('what to do'), when: s('time words, or empty for a to-do') },
  },
  {
    name: 'routine',
    desc: 'you carry out an instruction for me later or again and again (e.g. tell me the weather every morning, read out messages from someone)',
    kind: 'action',
    args: {
      when: req('e.g. in 10 minutes, at 5pm, every day at 6pm, whenever Sam messages me'),
      instruction: req('what to do then'),
    },
  },
  {
    name: 'alarm',
    desc: 'an alarm clock that rings at a time (e.g. to wake me up)',
    kind: 'action',
    args: { time: req('HH:MM, 24-hour'), label: s() },
  },
  {
    name: 'timer',
    desc: 'a countdown that rings after some minutes',
    kind: 'action',
    args: { minutes: num(0.1, 1440, true), label: s() },
  },
  {
    name: 'navigate',
    desc: 'start turn-by-turn directions',
    kind: 'action',
    args: {
      destination: req(),
      mode: oneOf(['driving', 'walking', 'transit', 'cycling']),
    },
  },
  {
    name: 'ride',
    desc: 'order a taxi/ride',
    kind: 'action',
    args: { destination: s(), app: oneOf(['uber', 'bolt', 'lyft', 'freenow']) },
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
  },
  {
    name: 'play',
    desc: 'start playing music, a podcast or a video',
    kind: 'action',
    args: { query: req(), app: s('app name, if said') },
  },
  {
    name: 'media',
    desc: 'control what is playing, or say what it is',
    kind: 'action',
    args: { command: oneOf(['play', 'pause', 'next', 'previous', 'stop', 'what'], true) },
  },
  {
    name: 'open_app',
    desc: 'open an app',
    kind: 'action',
    args: { name: req('app name') },
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
  },
  {
    name: 'birthdays',
    desc: 'birthdays from contacts',
    kind: 'info',
    args: { name: s(), within: oneOf(['next', 'week', 'month']) },
  },
  {
    name: 'weather',
    desc: 'weather forecast',
    kind: 'info',
    args: { place: s('town, or empty for here'), day: s('e.g. today, tomorrow, Saturday') },
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
  },
  {
    name: 'name_place',
    desc: 'name the place I am at',
    kind: 'action',
    args: { name: req() },
  },
  {
    name: 'watch',
    desc: 'keep an eye out with the camera and tell me when it sees something',
    kind: 'action',
    args: { thing: req(), every: bool(false) },
  },
  {
    name: 'stop_watching',
    desc: 'stop a camera watch',
    kind: 'action',
    args: { thing: s() },
  },
  {
    name: 'find_phone',
    desc: 'ring this phone loudly, or stop it ringing',
    kind: 'action',
    args: { stop: bool(false) },
  },
  {
    name: 'speech_speed',
    desc: 'change how fast you speak',
    kind: 'action',
    args: { change: oneOf(['faster', 'slower', 'normal']), percent: num(50, 200) },
  },
  {
    name: 'listening',
    desc: 'start or stop listening to the conversations around me',
    kind: 'action',
    args: { on: bool() },
  },
  {
    name: 'camera',
    desc: 'switch the live camera on or off',
    kind: 'action',
    args: { on: bool() },
  },
  {
    name: 'camera_setting',
    desc: 'change how the live camera works: front or back (selfie) camera, frame rate, image detail',
    kind: 'action',
    args: {
      frames: s('frame rate: more, fewer, normal, or a number per second'),
      lens: oneOf(['front', 'back', 'flip']),
      detail: oneOf(['low', 'medium', 'high', 'higher', 'lower', 'normal']),
    },
  },
  {
    name: 'missed',
    desc: 'short summary of my unread notifications (what I missed), by person and app',
    kind: 'info',
    args: {},
  },
  {
    name: 'feedback',
    desc: 'send feedback about Sidekick to its makers',
    kind: 'action',
    args: { text: req('the feedback, as said') },
  },
  {
    name: 'calculate',
    desc: 'work out a sum exactly (+ - * / ^ % sqrt and brackets)',
    kind: 'info',
    args: { expression: req('the sum in symbols, e.g. (17*23)+4 or 15%*240') },
  },
  {
    name: 'convert',
    desc: 'convert units (length, weight, volume, speed, area, data, time, temperature)',
    kind: 'info',
    args: { amount: num(-1e12, 1e12, true), from: req('unit'), to: req('unit') },
  },
  {
    name: 'date',
    desc: "today's date, a weekday, days until or since a date, leap years, days in a month",
    kind: 'info',
    args: {
      ask: oneOf(
        ['today', 'weekday', 'days_until', 'days_since', 'leap_year', 'days_in_month', 'add_days'],
        true,
      ),
      date: s('YYYY-MM-DD, if a date is meant'),
      days: num(-100000, 100000),
      year: num(1, 9999),
      month: num(1, 12),
    },
  },
  {
    name: 'time_in',
    desc: 'the time now in another city or country',
    kind: 'info',
    args: { place: req() },
  },
  {
    name: 'remember',
    desc: 'save a fact the user tells me to remember',
    kind: 'action',
    args: { fact: req('the fact, as said') },
  },
  {
    name: 'translate',
    desc: 'translate text into another language, or interpret a spoken conversation with someone who speaks it',
    kind: 'action',
    args: {
      text: s('the text, or empty for the text in the photo'),
      to: req('language'),
      // One tool for both: Gemma 4 E2B's sorter picked "translate" for 3 of 5 conversation
      // requests when interpreting was a tool of its own (bench/interpreter/routing.ts).
      talk: {
        type: 'boolean',
        desc: 'true if I want help talking with a person in that language (interpreting between us, both ways, out loud); false for a text to translate',
      },
    },
  },
  {
    name: 'repeat',
    desc: 'say the last answer again',
    kind: 'action',
    args: {},
  },
  {
    name: 'help',
    desc: 'say what Sidekick can do',
    kind: 'action',
    args: {},
  },
  {
    name: 'scan',
    desc: 'read a QR code or barcode with the camera',
    kind: 'action',
    args: {},
  },
  {
    name: 'list_watches',
    desc: 'say what the camera is watching for',
    kind: 'info',
    args: {},
  },
  {
    name: 'contact_number',
    desc: "a contact's phone number or email",
    kind: 'info',
    args: { name: req() },
  },
];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/**
 * Tools never offered to a routine run: a routine's question can carry outside text (an incoming
 * message), so nothing that acts at once on the phone is allowed — only answers and draft cards.
 */
export const NOT_IN_ROUTINES = new Set([
  'edit_photo',
  'make_picture',
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
  // A routine's text can carry outside words: never send, reply, call back, move or read copied text.
  'draft',
  'reply_message',
  'call_back',
  'move_event',
  'clipboard',
]);
const norm = (q: string) =>
  ` ${q
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;

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

const two = (n: number) => String(n).padStart(2, '0');
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** validateCall's refusal of a message, email or call to the user themselves. */
export const TO_USER = 'to is the user';

export type ToolCall = { tool: string; args: Record<string, unknown> };

/**
 * Arguments for the one tool the model already chose (decide-logic.ts): only the tool's own
 * line, so its argument values can't be mistaken for tool names. It may still decline.
 */
export function fillPrompt(question: string, now: Date, tool: ToolSpec): string {
  return `Now: ${now.toDateString()} ${localIso(now).slice(11)}.
Request: ${JSON.stringify(question)}
Tool: ${catalogText([tool])}

Reply with one JSON object of this tool's arguments, only those said or implied by the request. If this tool does not fit the request, reply {"none":true}.`;
}

/** The reply to [fillPrompt] → a call to [tool], {tool:'none'}, or null (not JSON). */
export function parseFillReply(reply: string, tool: string): ToolCall | null {
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
  if (r.none === true || r.tool === 'none') return { tool: 'none', args: {} };
  // Also accepted: the router's own shape {"tool":…, "args":{…}}.
  const inner = r.args ?? r.arguments;
  const args = inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : r;
  return { tool, args };
}

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
    return { ok: false, error: TO_USER };
  return { ok: true, args: out };
}

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

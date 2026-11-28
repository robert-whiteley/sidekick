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

import { SETTING_IDS, SETTING_OPS } from './settings-registry';

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
    'upscale (make it bigger and sharper). Only when asked to change the photo, not questions ' +
    'about it',
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
 * Always offered (decide.ts); drawn on the phone (picture.ts), which says so plainly and offers the
 * download when the picture model is missing or the phone (iPhone) can't make pictures.
 */
export const PICTURE_TOOL: ToolSpec = {
  name: 'make_picture',
  desc: 'draw, paint or generate a new picture or image of something',
  kind: 'info',
  args: {
    prompt: req('what to draw, in English, with style words (photo, cartoon, watercolour…)'),
  },
};

/**
 * Questions about an attached spreadsheet, worked out exactly in code (src/files/formula.ts).
 * Offered only while a spreadsheet is attached (sheet-query.ts adds that sheet's columns to the
 * description), so it isn't in the router's list.
 */
export const SHEET_TOOL: ToolSpec = {
  name: 'query_sheet',
  desc:
    'work out the answer from the attached spreadsheet with one Excel formula: totals, ' +
    'averages, counts, with conditions, per group, percentages, date differences, lookups, ' +
    'ranking, running totals, lists of matching rows; or a new column. Not for reading or ' +
    'summarising its text',
  kind: 'info',
  args: {
    formula: req(
      'one Excel formula; columns by header in brackets like [Amount], or letters like C:C; ' +
        "other sheets 'Name'!A:C",
    ),
    label: s('what the result is, a few words'),
    new_column: s('name of a new column the formula fills, one value per row, if asked to add one'),
  },
};

export const TOOLS: ToolSpec[] = [
  EDIT_TOOL,
  PICTURE_TOOL,
  {
    name: 'memory_search',
    desc: 'what I saw, heard, said, was told, or have in notes, calendar or contacts',
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
    name: 'find_on_phone',
    desc:
      "find a photo, screenshot, document or file saved on the phone (the user's gallery and " +
      'chosen folders) and say what it shows or says, e.g. the latest invoice and its total',
    kind: 'info',
    args: {
      what: req('what to look for, in a few words'),
      type: oneOf(['photo', 'file', 'any']),
      newest: { type: 'boolean', desc: 'true if the latest or most recent one is wanted' },
      from: when('start, if a time is meant'),
      to: when('end'),
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
    desc: 'only when I ask you to research a topic: several web searches and a short report with sources',
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
    // "Phone someone" alone made the sorter pick this for "I need to talk to a shop assistant who
    // speaks Japanese", which then asked for contacts access (Gemma 4 E2B, 27 Nov). Saying it is a
    // phone call fixed that (docs/BENCH.md).
    desc: 'ring someone on the phone (a phone call)',
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
    desc: 'add an appointment or meeting to my calendar (not an alarm or a reminder)',
    kind: 'action',
    args: { title: req(), when: req('time words, e.g. Friday at 3pm'), place: s() },
  },
  {
    name: 'reminder',
    desc: 'remind me of something with a notification at a time, or a to-do (if you are to do or tell me something then, that is routine)',
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
    args: {
      minutes: num(0.1, 1440, true, 'may be a fraction, e.g. 1.5 for 90 seconds'),
      label: s(),
    },
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
    desc: 'torch, volume, do not disturb, brightness, or open the wifi/bluetooth/airplane switch (not the camera or listening)',
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
    name: 'app_setting',
    desc:
      "say or change one of Sidekick's own settings (privacy, listening, online lookup, " +
      'consent, app lock, keep periods, voices, connections, models, routines, your data), or ' +
      'list a part of Settings. Not the phone’s own settings',
    kind: 'action',
    args: {
      do: oneOf([...SETTING_OPS]),
      setting: {
        type: 'string',
        values: [...SETTING_IDS, 'all'],
        required: true,
        desc: 'the setting meant; for list, any setting of that part',
      },
      value: s('the new value or the item, as said (e.g. on, 30 days, front, a name)'),
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
    // Typed or said in the chat, not to the interpreter screen (which reads its own turns):
    // without a session open the reply says so (interpreter-logic.ts interpreterControl).
    name: 'interpreter',
    desc: "stop interpreting, or change the other person's language in the interpreter",
    kind: 'action',
    args: {
      stop: { type: 'boolean', desc: 'true to stop interpreting' },
      to: s("the other person's new language, if named"),
    },
  },
  {
    name: 'repeat',
    desc: 'say the last answer again',
    kind: 'action',
    args: {},
  },
  {
    name: 'play_recording',
    desc: 'play back the saved recording of something said near me (to hear it again)',
    kind: 'info',
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
  'app_setting',
  'interpreter',
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

Reply with one JSON object of this tool's arguments, keyed by the argument names before the colons (for example ${argExample(tool)}), only those said or implied by the request. If this tool does not fit the request, reply {"none":true}.`;
}

/**
 * A one-key example of the reply's shape, from the tool's first argument. Without it the model
 * wrote edit_photo's choice as the key ({"crop":"square"}) instead of {"op":"crop"}, and every
 * call was refused (phone bench, 27 Nov).
 */
export function argExample(tool: ToolSpec): string {
  const [name, a] = Object.entries(tool.args)[0] ?? [];
  if (!name || !a) return '{}';
  const v = a.values?.[0] ?? (a.type === 'number' ? 1 : a.type === 'boolean' ? true : '...');
  return JSON.stringify({ [name]: v }).replace(/":/g, '": ');
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
  // And the arguments under the tool's own name, {"listening":{"on":false}} (seen on the phone).
  const keys = Object.keys(r);
  const only = keys.length === 1 ? r[tool] : undefined;
  const named = only && typeof only === 'object' ? only : undefined;
  const inner = r.args ?? r.arguments ?? named;
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
    // A choice written as a flag ({"grayscale": true} for {"op": "grayscale"}; seen on the phone
    // even after a retry): taken when exactly one such key is there and it carries nothing else.
    // Not for tools with an on/off argument, where the flag's value means something
    // ({"torch": true} is the torch on: asked again instead).
    if (
      (v === undefined || v === null) &&
      a.required &&
      a.values &&
      !Object.values(spec.args).some((x) => x.type === 'boolean')
    ) {
      const flag = (x: unknown) =>
        x === true || x === 1 || (!!x && typeof x === 'object' && !Object.keys(x).length);
      const keys = Object.keys(call.args).filter(
        (k) => a.values!.includes(k.toLowerCase()) && flag(call.args[k]),
      );
      if (keys.length === 1) v = keys[0].toLowerCase();
    }
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

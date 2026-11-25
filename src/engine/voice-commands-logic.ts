/**
 * Short spoken/typed commands answered without the model: speech speed, "repeat that", "what can
 * you do?", listening and camera on/off, camera watches ("tell me when you see my bus"), the note
 * template for the conversation going on ("this is a meeting"), and "scan this" (QR / barcode).
 * Pure parsing; tested in __tests__/voice-commands-test.ts.
 */

import type { NoteTemplateId } from '@/memory/note-templates';

export type VoiceCommand =
  | { type: 'speed'; rate: number | 'faster' | 'slower' | 'normal' }
  | { type: 'repeat' }
  | { type: 'help' }
  | { type: 'listening'; on: boolean }
  | { type: 'camera'; on: boolean }
  | { type: 'watch'; what: string; every: boolean }
  | { type: 'unwatch'; what: string | null }
  | { type: 'watchList' }
  | { type: 'template'; id: NoteTemplateId | null }
  | { type: 'scan' };

/** Speech speed limits (1 = normal). */
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
/** One "faster" / "slower" step. */
export const RATE_STEP = 0.15;

export const clampRate = (r: number) =>
  Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, r)) * 100) / 100;

/** The next speed after a "faster" / "slower" / "normal" / number command. */
export function nextRate(current: number, cmd: number | 'faster' | 'slower' | 'normal'): number {
  if (cmd === 'normal') return 1;
  if (typeof cmd === 'number') return clampRate(cmd);
  return clampRate(current + (cmd === 'faster' ? RATE_STEP : -RATE_STEP));
}

const clean = (q: string) =>
  q
    .trim()
    .toLowerCase()
    .replace(/[?!.,]+$/g, '')
    .replace(/^(hey |ok |okay )?(sidekick[, ]+)?/, '')
    .replace(/^(please |can you |could you |would you )+/, '')
    .replace(/ please$/, '')
    .trim();

const TEMPLATE_WORDS: [RegExp, NoteTemplateId][] = [
  [/\b(meeting|stand-?up|call with work|work call)\b/, 'meeting'],
  [/\b(lecture|class|lesson|seminar|talk|course)\b/, 'lecture'],
  [
    /\b(doctor'?s?|gp|appointment with (the|my) (doctor|nurse|gp)|medical|clinic|hospital)\b/,
    'doctor',
  ],
  [/\b(interview)\b/, 'interview'],
];

/** The command in [question], or null when it is an ordinary question. */
export function parseVoiceCommand(question: string): VoiceCommand | null {
  const q = clean(question);
  if (!q || q.length > 120) return null;
  let m: RegExpExecArray | null;

  // --- Speech speed ---
  if (
    (m =
      /^(?:set (?:the )?|change (?:the )?)?(?:speech|voice|talking|speaking) speed (?:to )?(\d{2,3}) ?(?:%|percent)$/.exec(
        q,
      ))
  )
    return { type: 'speed', rate: clampRate(Number(m[1]) / 100) };
  if (
    /^(speak|talk|read|go)( a (bit|little))? (slower|more slowly|slowly)( please)?$|^slow (down|it down)$|^(too fast|you'?re (talking|speaking) too fast)$/.test(
      q,
    )
  )
    return { type: 'speed', rate: 'slower' };
  if (
    /^(speak|talk|read|go)( a (bit|little))? (faster|quicker|more quickly)$|^speed (up|it up)$|^(too slow|you'?re (talking|speaking) too slowly?)$/.test(
      q,
    )
  )
    return { type: 'speed', rate: 'faster' };
  if (
    /^(speak|talk) (at )?(normal|the normal|regular) speed$|^(normal|reset) (speech|speaking|voice) speed$/.test(
      q,
    )
  )
    return { type: 'speed', rate: 'normal' };

  // --- Repeat ---
  if (
    /^(repeat( that| it| the answer| what you said)?|say (that|it) again|(sorry|pardon|what)\??( what did you say)?|come again|what did you (just )?say)$/.test(
      q,
    )
  )
    return { type: 'repeat' };

  // --- Help ---
  if (
    /^(what (can|do) you do|what are you able to do|what can i (ask|say)( you)?|help|how do i use (you|this|sidekick)|what (are )?your (skills|features))$/.test(
      q,
    )
  )
    return { type: 'help' };

  // --- Listening ---
  if (
    /^(stop|pause|turn off|switch off|end) (listening|the mic(rophone)?|recording)$|^stop recording( everything)?$|^(don'?t|do not) listen$/.test(
      q,
    )
  )
    return { type: 'listening', on: false };
  if (
    /^(start|resume|turn on|switch on) (listening|the mic(rophone)?|recording)$|^listen( in)?$/.test(
      q,
    )
  )
    return { type: 'listening', on: true };

  // --- Camera ---
  if (/^(pause|stop|turn off|switch off|close) (the )?(live )?camera$|^camera off$/.test(q))
    return { type: 'camera', on: false };
  if (/^(start|resume|turn on|switch on|open) (the )?(live )?camera$|^camera on$/.test(q))
    return { type: 'camera', on: true };

  // --- Camera watches ---
  if ((m = /^(?:stop|cancel|forget) (?:watching|looking) (?:out )?(?:for )?(.+)$/.exec(q)))
    return {
      type: 'unwatch',
      what: /^(it|that|everything|all|anything)$/.test(m[1]) ? null : stripArticle(m[1]),
    };
  if (/^(stop|cancel) (all )?(the )?watch(es|ing)?$|^stop looking$/.test(q))
    return { type: 'unwatch', what: null };
  if (/^what are you (watching|looking) (out )?for$|^(list|show)( my)? watch(es)?$/.test(q))
    return { type: 'watchList' };
  if (
    (m =
      /^(?:tell|let|warn|alert|ping|notify) me (?:know )?(?:when|if|as soon as|whenever|every time|each time) you (?:see|spot|notice) (.+)$/.exec(
        q,
      )) ||
    (m = /^(?:watch|look) (?:out )?for (.+)$/.exec(q)) ||
    (m = /^(?:keep an eye out|keep watch|keep a lookout) for (.+)$/.exec(q))
  ) {
    const every =
      /\b(whenever|every time|each time)\b/.test(q) || /\b(each|every) time\b/.test(m[1]);
    const what = stripArticle(m[1].replace(/\b(again|each time|every time)\b/g, '').trim());
    if (what && what.split(' ').length <= 8) return { type: 'watch', what, every };
  }

  // --- Note template for this conversation ---
  if (
    (m = /^(?:this is|we'?re in|we'?re having|i'?m in|i'?m at|i'?m having|it'?s) (.+)$/.exec(q))
  ) {
    const rest = m[1];
    if (/^(just )?(a |an )?(normal|ordinary|regular) (chat|conversation)$|^just a chat$/.test(rest))
      return { type: 'template', id: null };
    // "a meeting", "my doctor's appointment", "the team stand-up", "an interview with Jo".
    const head =
      /^(?:a |an |my |the |our )?(?:\w+ )?(\w+(?:'s)?(?: appointment)?|stand-?up)(?: (?:with|about|on) .+)?$/.exec(
        rest,
      );
    if (head)
      for (const [re, id] of TEMPLATE_WORDS) if (re.test(head[1])) return { type: 'template', id };
  }
  if (
    (m =
      /^(?:take|make|write|use) (meeting|lecture|doctor'?s?|interview) notes?(?: for this)?$/.exec(
        q,
      ))
  ) {
    for (const [re, id] of TEMPLATE_WORDS) if (re.test(m[1])) return { type: 'template', id };
  }

  // --- Scan ---
  if (
    /^(scan|read) (this|that|it|the|this qr|the qr|this bar ?code|the bar ?code)( (qr )?(code|bar ?code))?$|^scan$|^what('?s| is| does) (this|that) (qr )?(code|bar ?code)( say)?$|^what does (this|that|the) (qr )?(code|bar ?code) say$/.test(
      q,
    )
  )
    return { type: 'scan' };

  return null;
}

function stripArticle(s: string): string {
  return s.replace(/^(a|an|the|any|some)\s+/, '').trim();
}

/** "Speaking at 115%." etc. */
export function rateReply(rate: number): string {
  if (rate === 1) return 'Back to normal speed.';
  if (rate <= MIN_RATE) return 'This is the slowest I can speak.';
  if (rate >= MAX_RATE) return 'This is the fastest I can speak.';
  return `OK, speaking at ${Math.round(rate * 100)}% speed.`;
}

/** What "what can you do?" says, from what is actually switched on. */
export function helpText(on: {
  camera: boolean;
  listening: boolean;
  memory: boolean;
  calendar: boolean;
  messages: boolean;
  email: boolean;
  online: boolean;
  location: boolean;
}): string {
  const can: string[] = [
    'answer questions and remember things you tell me',
    'set reminders, timers and alarms',
    'do sums and conversions, and translate',
  ];
  if (on.camera)
    can.push(
      'tell you what the camera sees, and watch for something ("tell me when you see my bus")',
    );
  else can.push('look at a photo ("what am I looking at?")');
  if (on.memory)
    can.push(
      'find what you saw or heard earlier ("what did Sam say this morning?") and recap any time',
    );
  if (on.listening) can.push('keep live notes of conversations');
  if (on.calendar) can.push('read and add calendar events');
  if (on.messages) can.push('read and reply to messages');
  if (on.email) can.push('send emails');
  if (on.location) can.push('say where you were');
  if (on.online) can.push('look things up online');
  const off: string[] = [];
  if (!on.listening) off.push('Listen');
  if (!on.online) off.push('Online lookup');
  const tail = off.length ? ` More with ${off.join(' and ')} in Settings.` : '';
  return `I can ${can.slice(0, -1).join(', ')} and ${can.at(-1)}.${tail}`;
}

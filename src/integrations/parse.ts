/**
 * Rules that turn a spoken or typed request into an action, without the model, so common
 * requests are instant and exact. Anything these rules don't recognise but that looks like an
 * action goes to the model (llm-parse.ts). Pure; tested in __tests__/integrations-parse-test.ts.
 */
import { parseWhen, TIME_WORDS } from '@/memory/followup-logic';
import type { MediaCommand } from './native';
import type { MessageApp } from './types';

export type Intent =
  | { type: 'message'; name: string; text: string; app: MessageApp }
  | { type: 'reply'; name: string | null; text: string }
  | { type: 'email'; name: string; subject: string; body: string }
  | { type: 'call'; name: string }
  | { type: 'alarm'; hour: number; minute: number; label: string }
  | { type: 'timer'; seconds: number; label: string }
  | { type: 'navigate'; destination: string; mode: 'driving' | 'walking' | 'transit' | 'cycling' }
  | { type: 'media'; cmd: MediaCommand }
  | { type: 'nowPlaying' }
  | { type: 'readMessages'; name: string | null }
  | { type: 'readNotifications' }
  | {
      type: 'event';
      title: string;
      start: number;
      end: number;
      allDay: boolean;
      location: string;
    }
  | { type: 'sendIt' }
  | { type: 'cancelIt' };

const LEAD =
  /^(?:hey |ok |okay )?(?:sidekick,? )?(?:please |pls )?(?:(?:can|could|would|will) you (?:please )?)?/i;
const TAIL = /[\s,]*(?:please|thanks|thank you)?[.!?]*$/i;

function clean(q: string): string {
  return q.trim().replace(/\s+/g, ' ').replace(LEAD, '').replace(TAIL, '').trim();
}

const APP_WORDS: [RegExp, MessageApp][] = [
  [/^whats ?app$/i, 'whatsapp'],
  [/^(sms|text|texts|messages|imessage)$/i, 'sms'],
  [/^telegram$/i, 'telegram'],
  [/^signal$/i, 'signal'],
];

function appFrom(word: string | undefined): MessageApp {
  if (!word) return 'auto';
  for (const [re, app] of APP_WORDS) if (re.test(word.trim())) return app;
  return 'auto';
}

/** Words that start the message itself, so the name ends before them ("text Sam I'm late"). */
const MESSAGE_START =
  /^(i|i'm|im|i'll|ill|i've|i'd|we|we're|we'll|you|your|are|is|can|could|will|would|do|did|don't|dont|have|has|what|where|when|how|why|who|running|on|be|see|sorry|thanks|thank|hi|hello|hey|yes|no|ok|okay|just|please|love|happy|good|call|meet|let's|lets|bring|get|pick|remember|it's|its|that's|there|the|my|our|a)\b/i;

const PRONOUN_SAY =
  /\s+(?:saying|that says|to say|and say|and tell (?:him|her|them)|telling (?:him|her|them)|that|:|,|-)\s+/i;

/**
 * Splits "Sam Taylor saying I'm late" / "Sam I'm late" into name and text. With known contact
 * names the longest one at the start wins; otherwise the text starts at a separator word or a
 * word that begins a sentence.
 */
export function splitNameAndText(
  rest: string,
  contacts: string[] = [],
): { name: string; text: string } | null {
  const lower = rest.toLowerCase();
  const known = contacts
    .filter((c) => c && lower.startsWith(c.toLowerCase() + ' '))
    .sort((a, b) => b.length - a.length)[0];
  if (known) {
    const text = rest
      .slice(known.length)
      .replace(/^\s*(?:saying|that says|to say|and say|that|:|,|-)\s*/i, '')
      .trim();
    return text ? { name: known, text } : null;
  }
  const sep = PRONOUN_SAY.exec(rest);
  if (sep && sep.index > 0 && sep.index < 40) {
    const name = rest.slice(0, sep.index).trim();
    const text = rest.slice(sep.index + sep[0].length).trim();
    if (name.split(' ').length <= 3 && text) return { name, text };
  }
  const words = rest.split(' ');
  for (let i = 1; i < Math.min(words.length, 4); i++) {
    if (MESSAGE_START.test(words[i])) {
      return { name: words.slice(0, i).join(' '), text: words.slice(i).join(' ') };
    }
  }
  // Fall back to a one-word name.
  return words.length > 1 ? { name: words[0], text: words.slice(1).join(' ') } : null;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function stripWhen(text: string): string {
  let t = ` ${text} `;
  for (const re of TIME_WORDS) t = t.replace(new RegExp(re.source, 'gi'), ' ');
  return t
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(an? |the )?(event|reminder)( for| called| about)?\s+/i, '')
    .replace(/^(an? |the )(?=\w)/i, '')
    .replace(/\s+(on|at|for|from)$/i, '')
    .trim();
}

/** "7", "7:30", "7.30am", "6 pm", "half past six": hour and minute, no am/pm guessing past 12. */
export function clockTime(s: string): { hour: number; minute: number } | null {
  const t = s.toLowerCase().replace(/\./g, ':');
  if (/\b(noon|midday)\b/.test(t)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(t)) return { hour: 0, minute: 0 };
  const NUM: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12,
  }; // prettier-ignore
  const n = (w: string) => NUM[w] ?? parseInt(w, 10);
  let h: number;
  let m = 0;
  let mer: string | undefined;
  let r: RegExpExecArray | null;
  if ((r = /\b(half|quarter) (past|to) (\d{1,2}|[a-z]+)\b/.exec(t))) {
    h = n(r[3]);
    m = r[1] === 'half' ? 30 : 15;
    if (r[2] === 'to') [h, m] = [h - 1, 45];
    mer = /\b(pm|p m|evening|tonight)\b/.test(t) ? 'pm' : undefined;
  } else if ((r = /\b(\d{1,2})(?::(\d{2}))? ?(am|pm|a m|p m|o'?clock)?\b/.exec(t))) {
    [h, m, mer] = [+r[1], r[2] ? +r[2] : 0, r[3]];
  } else if (
    (r =
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?: ?(am|pm|a m|p m))?/.exec(
        t,
      ))
  ) {
    [h, mer] = [n(r[1]), r[2]];
  } else return null;
  if (Number.isNaN(h) || h > 23 || m > 59) return null;
  mer = mer?.replace(' ', '');
  if (!mer && /\b(evening|tonight|in the afternoon)\b/.test(t)) mer = 'pm';
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;
  return { hour: h, minute: m };
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600 };

function durationSeconds(s: string): number | null {
  const t = s
    .toLowerCase()
    .replace(/\ban?\b/g, '1')
    .replace(/\bhalf (?:1|an) hour\b/, '30 minutes');
  let total = 0;
  const re =
    /(\d+(?:\.\d+)?|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|forty-five|sixty) ?(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/g;
  const WORD: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30,
    forty: 40, 'forty-five': 45, sixty: 60,
  }; // prettier-ignore
  let r: RegExpExecArray | null;
  while ((r = re.exec(t))) {
    const v = WORD[r[1]] ?? parseFloat(r[1]);
    total += v * UNIT_SECONDS[r[2][0]];
  }
  if (/\bhalf (?:1|an) hour\b/.test(s.toLowerCase())) total ||= 1800;
  return total > 0 ? Math.round(total) : null;
}

/** "Text me…", "call myself": no contact to send to; the request is for an answer instead. */
const SELF = /^(me|myself|us|ourselves|i)$/i;

/** Reads one request. `contacts` (names) helps split "text Sam Taylor I'm late". */
export function parseIntent(question: string, now: Date, contacts: string[] = []): Intent | null {
  const i = parseIntentRaw(question, now, contacts);
  if (
    i &&
    (i.type === 'message' || i.type === 'email' || i.type === 'call') &&
    SELF.test(i.name.trim())
  )
    return null;
  return i;
}

function parseIntentRaw(question: string, now: Date, contacts: string[]): Intent | null {
  const q = clean(question);
  if (!q) return null;
  let m: RegExpExecArray | null;

  if (
    /^(yes,? )?(send it|send that|send|go ahead and send( it)?|yes send( it)?|ok send( it)?)$/i.test(
      q,
    )
  )
    return { type: 'sendIt' };
  if (/^(cancel( it| that)?|don't send( it)?|do not send( it)?|never ?mind)$/i.test(q))
    return { type: 'cancelIt' };

  // --- Media ---
  if (/^(pause|stop)( the)?( music| song| playback| podcast| audio)?$/i.test(q))
    return { type: 'media', cmd: 'pause' };
  if (/^(play|resume|unpause|continue)( the)?( music| song| playback| podcast)?$/i.test(q))
    return { type: 'media', cmd: 'play' };
  if (/^(next|skip)( this)?( song| track| one)?$|^(play the )?next (song|track)$/i.test(q))
    return { type: 'media', cmd: 'next' };
  if (
    /^(previous|last|go back( a)?)( song| track)$|^play the (previous|last) (song|track)$/i.test(q)
  )
    return { type: 'media', cmd: 'previous' };
  if (
    /^(what('s| is) (this song|(that |this )?playing|the song)|what song is (this|playing)|who sings this)$/i.test(
      q,
    )
  )
    return { type: 'nowPlaying' };

  // --- Timers and alarms ---
  if (
    /\b(timer|countdown|count down)\b/i.test(q) &&
    /^(set|start|make|put on|create)?\s*(an? )?\b/i.test(q)
  ) {
    const secs = durationSeconds(q);
    const label = /\btimer for (?:the )?([a-z ]+?) (?:for|in)\b/i.exec(q)?.[1] ?? '';
    if (
      secs &&
      /^(set|start|make|put|create|an? |timer|\d|one|two|three|four|five|ten|fifteen|twenty|thirty)/i.test(
        q,
      )
    )
      return { type: 'timer', seconds: secs, label: capitalise(label) };
  }
  if (
    (m = /^(?:set|make|create|add)(?: an| a| my)? alarm(?: for| at)? (.+)$/i.exec(q)) ||
    (m = /^wake me(?: up)?(?: at| for)? (.+)$/i.exec(q))
  ) {
    const t = clockTime(m[1]);
    if (t) {
      const label = /\b(?:called|labelled|for (?!\d)([a-z ]+))$/i.exec(m[1])?.[1] ?? '';
      return { type: 'alarm', ...t, label: capitalise(label.trim()) };
    }
  }

  // --- Navigation ---
  if (
    (m =
      /^(?:navigate|directions|give me directions|get directions|take me|get me|drive me|guide me|how do i get|show me the way|route me)(?: me)?(?: to| home)? ?(.*)$/i.exec(
        q,
      ))
  ) {
    let dest = m[1].trim() || (/\bhome\b/i.test(q) ? 'home' : '');
    let mode: 'driving' | 'walking' | 'transit' | 'cycling' = 'driving';
    const by =
      /\s+(?:by|on) (foot|walking|bike|bicycle|cycling|car|driving|bus|train|transit|public transport)$|\s+walking$/i.exec(
        dest,
      );
    if (by) {
      const w = (by[1] ?? 'walking').toLowerCase();
      mode = /foot|walk/.test(w)
        ? 'walking'
        : /bike|cycl/.test(w)
          ? 'cycling'
          : /bus|train|transit|public/.test(w)
            ? 'transit'
            : 'driving';
      dest = dest.slice(0, by.index).trim();
    }
    if (/^(walk|walking)\b/i.test(q)) mode = 'walking';
    if (dest) return { type: 'navigate', destination: dest, mode };
  }

  // --- Calls ---
  if (
    (m =
      /^(?:call|ring|phone|dial|facetime)(?: up)? (?!me\b|it\b|this\b|that\b)(.+?)(?: (?:now|back|for me))?$/i.exec(
        q,
      ))
  ) {
    if (!/\b(what|called)\b/i.test(m[1]) && m[1].split(' ').length <= 4)
      return { type: 'call', name: m[1] };
  }

  // --- Reading ---
  if (
    /^(read|show|check|tell me)( me)? (my )?(new |latest |unread )?notifications$|^(any|what are my|do i have any) (new )?notifications$/i.test(
      q,
    )
  )
    return { type: 'readNotifications' };
  if ((m = /^what did (.+?) (say|send|text|write|message)( me)?$/i.exec(q)))
    return { type: 'readMessages', name: m[1] };
  if (
    /^(read|show|check|tell me)( me)? (my )?(new |latest |unread )?(messages|texts|whats ?apps?)$|^(any|have i got any|do i have any|did i get any) (new )?(messages|texts|whats ?apps?)$/i.test(
      q,
    )
  )
    return { type: 'readMessages', name: null };

  // --- Replies ---
  if ((m = /^reply to (?:him|her|them|it|that)(?: saying| with| that|:|,)? (.+)$/i.exec(q)))
    return { type: 'reply', name: null, text: capitalise(m[1]) };
  if ((m = /^reply to (.+)$/i.exec(q))) {
    const split = splitNameAndText(m[1], contacts);
    if (split) return { type: 'reply', name: split.name, text: capitalise(split.text) };
  }
  if ((m = /^reply(?: saying| with| that|:|,)? (.+)$/i.exec(q)))
    return { type: 'reply', name: null, text: capitalise(m[1]) };

  // --- Email (before messages: "send an email to …") ---
  if (
    (m = /^(?:send |write |draft )?(?:an? )?e-?mail(?: to)? (.+)$/i.exec(q)) ||
    (m = /^e-?mail (.+)$/i.exec(q))
  ) {
    const rest = m[1];
    const about =
      /^(.+?) (?:about|re|regarding|subject) (.+?)(?:(?: saying| that says|:|,| and say| to say) (.+))?$/i.exec(
        rest,
      );
    if (about) {
      return {
        type: 'email',
        name: about[1],
        subject: capitalise(about[2]),
        body: capitalise(about[3] ?? ''),
      };
    }
    const split = splitNameAndText(rest, contacts);
    if (split)
      return { type: 'email', name: split.name, subject: '', body: capitalise(split.text) };
    return { type: 'email', name: rest, subject: '', body: '' };
  }

  // --- Messages ---
  if (
    (m =
      /^(?:send |write |draft )?(?:an? )?(whats ?app|text|sms|message|telegram|signal)(?: message)?(?: to)? (.+)$/i.exec(
        q,
      )) ||
    (m = /^(text|message|whats ?app|tell|let) (.+)$/i.exec(q))
  ) {
    let verb = m[1];
    let rest = m[2];
    // "let Sam know I'm late"
    if (/^let$/i.test(verb)) {
      const k = /^(.+?) know(?: that)? (.+)$/i.exec(rest);
      if (!k) return null;
      rest = `${k[1]} saying ${k[2]}`;
      verb = 'message';
    }
    if (/^tell$/i.test(verb) && /^(me|us)\b/i.test(rest)) return null;
    let app = appFrom(/^(whats ?app|telegram|signal|sms)$/i.test(verb) ? verb : undefined);
    const on = / on (whats ?app|telegram|signal|sms|messages)\b/i.exec(rest);
    if (on) {
      app = appFrom(on[1]);
      rest = (rest.slice(0, on.index) + rest.slice(on.index + on[0].length)).trim();
    }
    const split = splitNameAndText(rest, contacts);
    if (split) return { type: 'message', name: split.name, text: capitalise(split.text), app };
  }

  // --- Calendar ---
  if (
    (m =
      /^(?:add|put|schedule|create|book|make|pencil in|stick)(?: in)? (.+?) (?:to|in|on|into|in to) (?:my |the )?(?:calendar|diary|schedule)(?: (.+))?$/i.exec(
        q,
      )) ||
    (m = /^(?:add|put) (?:to|in|on) (?:my |the )?(?:calendar|diary)[:,]? (.+)$/i.exec(q)) ||
    (m = /^(?:schedule|book) (?:an? )?((?:meeting|appointment|call|dinner|lunch).+)$/i.exec(q))
  ) {
    const text = [m[1], m[2]].filter(Boolean).join(' ');
    const when = parseWhen(text, now);
    const title = capitalise(stripWhen(text));
    if (title && when) {
      const dur = durationSeconds(
        /\bfor (.+? (?:hours?|minutes?|mins?|hrs?))\b/i.exec(text)?.[1] ?? '',
      );
      const start = when.at;
      const end = when.allDay ? start : start + (dur ?? 3600) * 1000;
      return {
        type: 'event',
        title: title.replace(/\s+for \d+.*$/i, ''),
        start,
        end,
        allDay: when.allDay,
        location: '',
      };
    }
  }

  return null;
}

/**
 * Looks like an action the rules couldn't read ("could you drop Sam a line about Friday"):
 * worth asking the model. Kept narrow so ordinary questions never take the slower path.
 */
export function mightBeAction(question: string): boolean {
  const q = clean(question).toLowerCase();
  if (
    /^(what|who|where|when|why|how|is|are|do|does|did|which)\b/.test(q) &&
    !/^(what did .+ say)/.test(q)
  )
    return false;
  return /\b(text|message|whatsapp|e-?mail|drop .+ a line|let .+ know|tell|calendar|diary|schedule|appointment|meeting|alarm|timer|navigate|directions|call|ring)\b/.test(
    q,
  );
}

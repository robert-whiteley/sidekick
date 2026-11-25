/**
 * The model reads requests the rules (parse.ts) can't, in its own throwaway chat. It only fills
 * a draft: the user still sees the card and taps Send, so a wrong guess costs a tap, not a
 * message to the wrong person.
 */
import { parseWhen } from '@/memory/followup-logic';
import type { Intent } from './parse';

export const INTENT_SYSTEM =
  'You turn a request into one JSON object for a phone assistant. Reply with JSON only, no other text.';

export function intentPrompt(question: string, now: Date): string {
  return `Today is ${now.toDateString()}, ${now.toTimeString().slice(0, 5)}.
Request: ${JSON.stringify(question)}

Reply with exactly one of:
{"type":"message","name":"<person>","text":"<message, written as the user>","app":"whatsapp|sms|telegram|signal|auto"}
{"type":"email","name":"<person>","subject":"<short subject>","body":"<email text>"}
{"type":"event","title":"<title>","when":"<time words, e.g. tomorrow at 3pm>","location":"<place or empty>"}
{"type":"call","name":"<person>"}
{"type":"none"}
Use {"type":"none"} unless the user is clearly asking to send, schedule or call.`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The model's reply → an intent, or null (not JSON, "none", or missing fields). */
export function intentFromModel(reply: string, now: Date): Intent | null {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0];
  if (!json) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  const name = str(o.name);
  switch (o.type) {
    case 'message': {
      const text = str(o.text);
      const app = str(o.app);
      if (!name || !text) return null;
      const ok = ['whatsapp', 'sms', 'telegram', 'signal'].includes(app);
      return { type: 'message', name, text, app: ok ? (app as 'sms') : 'auto' };
    }
    case 'email':
      if (!name) return null;
      return { type: 'email', name, subject: str(o.subject), body: str(o.body) };
    case 'call':
      return name ? { type: 'call', name } : null;
    case 'event': {
      const title = str(o.title);
      const when = parseWhen(str(o.when), now);
      if (!title || !when) return null;
      return {
        type: 'event',
        title,
        start: when.at,
        end: when.allDay ? when.at : when.at + 3600_000,
        allDay: when.allDay,
        location: str(o.location),
      };
    }
    default:
      return null;
  }
}

/** Asks the model (loads it if needed). Null on any failure. */
export async function intentFromLlm(question: string, now: Date): Promise<Intent | null> {
  try {
    const { askLlm } = await import('@/engine/llm');
    const { text } = await askLlm(intentPrompt(question, now), null, () => {}, {
      system: INTENT_SYSTEM,
      maxTokens: 160,
      scratch: true,
    });
    return intentFromModel(text, now);
  } catch {
    return null;
  }
}

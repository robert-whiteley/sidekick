/**
 * Read back before sending (like a car's voice assistant): Sidekick says what it is about to send
 * and listens for "yes", "no", "change it to …" or "add …". Pure; tested in
 * __tests__/readback-logic-test.ts. Runtime wiring: engine/hands-free.ts, engine/actions.ts.
 */
import type { Draft } from '@/integrations/types';

export type ReadBackMode = 'voice' | 'always' | 'off';
/** Recommended: read back when the request was spoken or the phone is hands-free. */
export const READ_BACK_RECOMMENDED: ReadBackMode = 'voice';
/** How long Sidekick listens for the answer after reading back. */
export const READ_BACK_REPLY_MS = 6000;
/** A read-back answer only counts this long after the read-back. */
export const READ_BACK_TTL_MS = 60_000;

export function readBackWanted(
  mode: ReadBackMode | null | undefined,
  o: { spoken: boolean; handsFree: boolean; speechAllowed: boolean },
): boolean {
  if (!o.speechAllowed) return false;
  switch (mode ?? READ_BACK_RECOMMENDED) {
    case 'always':
      return true;
    case 'off':
      return false;
    default:
      return o.spoken || o.handsFree;
  }
}

function spokenTime(ms: number, allDay: boolean): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  if (allDay) return day;
  return `${day} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

const end = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** What Sidekick says before sending: who, what, and the question. */
export function readBackText(d: Draft): string {
  const sched = d.scheduledAt ? ` at ${spokenTime(d.scheduledAt, false)}` : '';
  switch (d.kind) {
    case 'message': {
      const who = d.fields.replyKey ? `Reply to ${d.fields.name}` : `Text to ${d.fields.name}`;
      return `${who}${sched}: ${end(d.fields.text)} Send it?`;
    }
    case 'email': {
      const subj = d.fields.subject ? `, subject ${end(d.fields.subject).replace(/\.$/, '')}` : '';
      return `Email to ${d.fields.name}${sched}${subj}: ${end(d.fields.body)} Send it?`;
    }
    case 'event':
      return `${d.fields.eventId ? 'Move' : 'Add'} ${d.fields.title}, ${spokenTime(d.fields.start, d.fields.allDay)}${d.fields.location ? `, at ${d.fields.location}` : ''}, ${d.fields.eventId ? 'in' : 'to'} your calendar?`;
    case 'call':
      return `Call ${d.fields.name}?`;
  }
}

export type ConfirmReply =
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'replace'; text: string }
  | { kind: 'append'; text: string };

const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

const join = (a: string, b: string) => {
  const base = a.trim().replace(/[.!?]?$/, (p) => p || '.');
  return `${base} ${b.charAt(0).toUpperCase()}${b.slice(1)}`;
};

/** The draft's fields after "change it to …" / "add …". Calls can't be edited by voice. */
export function editedFields(d: Draft, edit: ConfirmReply): Partial<Draft['fields']> | null {
  if (edit.kind !== 'replace' && edit.kind !== 'append') return null;
  const t = edit.kind === 'replace' ? cap(edit.text) : edit.text;
  switch (d.kind) {
    case 'message':
      return { text: edit.kind === 'replace' ? t : join(d.fields.text, t) };
    case 'email':
      return { body: edit.kind === 'replace' ? t : join(d.fields.body, t) };
    case 'event':
      return edit.kind === 'replace' ? { title: t } : { location: t };
    case 'call':
      return null;
  }
}

// --- When the rules can't tell: a short scratch pass of the model ---

export function confirmPrompt(readBack: string, heard: string): string {
  return `The assistant asked: ${JSON.stringify(readBack)}
The user answered: ${JSON.stringify(heard)}

Reply with exactly one JSON object:
{"answer":"yes"} to send as it is,
{"answer":"no"} to cancel,
{"answer":"replace","text":"<the new message text, written as the user>"} to change it,
{"answer":"append","text":"<words to add>"} to add to it,
{"answer":"other"} if the user is asking something else.`;
}

export function confirmFromModel(reply: string): ConfirmReply | null {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0];
  if (!json) return null;
  try {
    const o = JSON.parse(json) as { answer?: unknown; text?: unknown };
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    if (o.answer === 'yes') return { kind: 'yes' };
    if (o.answer === 'no') return { kind: 'no' };
    if ((o.answer === 'replace' || o.answer === 'append') && text) return { kind: o.answer, text };
  } catch {}
  return null;
}

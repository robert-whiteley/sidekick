/**
 * Scheduled send: "at 6pm text Sam I'm on my way", "text Sam at 6pm saying …", "email Jo tomorrow
 * morning about the report", "tell Sam I'm home, send it at 9". A time inside the message itself
 * ("text Sam I'll see you tomorrow") is part of the message, so only these places count: before
 * the verb, right after the recipient, or after "send it". Pure; tested in
 * __tests__/schedule-logic-test.ts.
 */
import { parseWhen, TIME_WORDS } from '@/memory/followup-logic';

const VERB =
  /^(?:please )?(?:text|message|msg|whatsapp|sms|email|e-mail|mail|tell|send (?:a )?(?:text|message|email) to)\b/i;

type Span = { start: number; end: number };

function timeSpans(s: string): Span[] {
  const spans: Span[] = [];
  for (const re of TIME_WORDS) {
    const g = new RegExp(re.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = g.exec(s))) spans.push({ start: m.index, end: m.index + m[0].length });
  }
  spans.sort((a, b) => a.start - b.start);
  // Merge overlapping spans and ones joined only by spaces, commas or "at".
  const out: Span[] = [];
  for (const sp of spans) {
    const last = out[out.length - 1];
    if (last && (sp.start <= last.end || /^[\s,]*(at\s*)?$/i.test(s.slice(last.end, sp.start))))
      last.end = Math.max(last.end, sp.end);
    else out.push({ ...sp });
  }
  return out;
}

/** The request without its send time, and the time; null when no send time is given. */
export function splitSchedule(
  question: string,
  now: Date,
): { rest: string; at: number; whenText: string } | null {
  const q = question.trim().replace(/[.!]+$/, '');
  for (const sp of timeSpans(q)) {
    const before = q.slice(0, sp.start).trim();
    const after = q.slice(sp.end).trim();
    const when = q.slice(sp.start, sp.end);
    let rest: string | null = null;
    // "At 6pm, text Sam …" / "Tomorrow morning email Jo …"
    if (!before && VERB.test(after.replace(/^[,\s]+/, ''))) rest = after.replace(/^[,\s]+/, '');
    // "Text Sam at 6pm saying …" / "Email Jo Smith tomorrow morning about …"
    else if (VERB.test(before) && /^\S+\s+\S+(\s+\S+)?$/.test(before) && after)
      rest = `${before} ${after.replace(/^(?:,\s*)/, '')}`;
    // "… , send it at 9" / "… and send it tomorrow morning"
    else if (/[,\s](?:and )?(?:send|schedule) it( for)?$|[,\s]send( for)?$/i.test(before) && !after)
      rest = before.replace(/,?\s*(?:and )?(?:send|schedule)( it)?( for)?$/i, '').trim();
    if (!rest || !VERB.test(rest)) continue;
    const t = parseWhen(when, now);
    if (!t || t.at <= now.getTime()) continue;
    return { rest, at: t.at, whenText: when.trim() };
  }
  return null;
}

/** "Sends at 18:00", "Sends tomorrow at 08:00", "Sends Fri 12 Dec at 09:00". */
export function sendsAtText(at: number, now: Date): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  if (diff === 0) return `Sends at ${time}`;
  if (diff === 1) return `Sends tomorrow at ${time}`;
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `Sends ${date} at ${time}`;
}

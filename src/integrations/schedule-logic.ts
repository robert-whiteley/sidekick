/**
 * Scheduled send: "at 6pm text Sam I'm on my way", "text Sam at 6pm saying …", "email Jo tomorrow
 * morning about the report", "tell Sam I'm home, send it at 9". A time inside the message itself
 * ("text Sam I'll see you tomorrow") is part of the message, so only these places count: before
 * the verb, right after the recipient, or after "send it". Pure; tested in
 * __tests__/schedule-logic-test.ts.
 */

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

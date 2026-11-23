/**
 * Searchable text for saved photos. While the phone is idle (and the model is already loaded),
 * Sidekick reads each saved photo once: any visible text verbatim plus a one-line description.
 * That text goes into the moment so word search and meaning search can find the photo later.
 */

export const DESCRIBE_PROMPT =
  'Look at this photo. First copy any readable text exactly as written (signs, labels, screens, ' +
  'documents). Then describe the scene in one sentence. Reply in this form and nothing else:\n' +
  'Text: <the text, or none>\nScene: <one sentence>';

/** Turns the model's reply into one compact line, e.g. `Text: "PLATFORM 4" · Scene: a station.` */
export function parseDescription(raw: string): string | null {
  const clean = raw.replace(/[*_`#>]+/g, '').trim();
  if (!clean) return null;
  const text = /text:\s*(.+?)(?=\n|scene:|$)/is.exec(clean)?.[1]?.trim();
  const scene = /scene:\s*(.+)$/is.exec(clean)?.[1]?.replace(/\s+/g, ' ').trim();
  const parts: string[] = [];
  if (text && !/^(none|no text|n\/a)\.?$/i.test(text)) parts.push(`Text: "${text}"`);
  if (scene) parts.push(`Scene: ${scene}`);
  if (!parts.length) parts.push(clean.replace(/\s+/g, ' ').slice(0, 400));
  return parts.join(' · ');
}

/** Longest OCR text kept per photo (a full page of a document is still searchable by its start). */
export const MAX_READ_CHARS = 1000;

/**
 * Turns OCR lines into one compact line, e.g. `CORNER CAFE · Total GBP 6.35`; null when nothing
 * readable was found (a lone stray mark is not text).
 */
export function formatOcr(lines: string[]): string | null {
  const parts = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const joined = parts.join(' · ');
  if ((joined.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 2) return null;
  return joined.length > MAX_READ_CHARS ? `${joined.slice(0, MAX_READ_CHARS - 1)}…` : joined;
}

/** Adds the OCR text to a moment's text as a `Read:` line (replacing an older one), before `Seen:`. */
export function appendRead(text: string, read: string): string {
  const lines = text.split('\n').filter((l) => !l.startsWith('Read: '));
  const seen = lines.findIndex((l) => l.startsWith('Seen: '));
  const line = `Read: "${read}"`;
  if (seen >= 0) lines.splice(seen, 0, line);
  else lines.push(line);
  return lines.join('\n').trim();
}

/** The photo's exact text for a question's prompt, so the model copies numbers instead of guessing. */
export function ocrPromptLine(read: string | null): string {
  return read ? `Text read from the photo by OCR (exact): "${read}"\n` : '';
}

/** Adds the description to a moment's text (once). */
export function appendSeen(text: string, description: string): string {
  const base = text.replace(/\n?Seen: .*$/s, '').trim();
  return base ? `${base}\nSeen: ${description}` : `Seen: ${description}`;
}

/** Reading a photo takes ~25 s of CPU on older phones: only when idle, loaded, and not draining. */
export function shouldDescribeNow(s: {
  llmLoaded: boolean;
  busy: boolean;
  charging: boolean;
  batteryLevel: number; // 0..1, or -1 if unknown
  lowPowerMode: boolean;
}): boolean {
  if (!s.llmLoaded || s.busy || s.lowPowerMode) return false;
  return s.charging || s.batteryLevel >= 0.5;
}

/** Text stored for a captured photo, before it has been described. */
export function captureText(note: string | null): string {
  const n = note?.trim();
  return n ? `Captured photo. Voice note: ${n}` : 'Captured photo.';
}

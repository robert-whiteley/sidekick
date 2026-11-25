/**
 * Sends an approved email from the user's Gmail account (Gmail API, scope gmail.send only:
 * Sidekick can send but never read mail). The sign-in uses Google's Authorization API on the
 * phone; there is no Sidekick server. Inactive until the owner's Google Cloud OAuth client is
 * set up and `expo.extra.google.androidClientId` is filled in app.json (ADR 0008).
 */
import { googleConfigured, googleFetch } from './google';
import { integrationsNative } from './native';
import type { EmailFields } from './types';

export { OfflineError } from './google';

export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export function gmailConfigured(extra?: unknown): boolean {
  return extra === undefined ? googleConfigured() : googleConfigured(extra);
}

export function gmailAvailable(): boolean {
  return gmailConfigured() && !!integrationsNative();
}

function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    s += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return s;
}

const base64url = (bytes: number[]) =>
  base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** RFC 2822 message, UTF-8, as the Gmail API's base64url `raw` field. */
export function rawEmail(to: string, subject: string, body: string): string {
  if (/[\r\n]/.test(to) || /[\r\n]/.test(subject)) throw new Error('Bad header');
  const subj = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${base64(utf8(subject))}?=`;
  const msg = [
    `To: ${to}`,
    `Subject: ${subj}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64(utf8(body)).replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n');
  return base64url(utf8(msg));
}

/** Sends; throws OfflineError when there is no connection (the caller queues it). */
export async function sendGmail(f: EmailFields, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!integrationsNative() || !gmailConfigured())
    throw new Error('Gmail sending is not set up on this phone');
  if (!f.to) throw new Error('No email address');
  const res = await googleFetch(
    'gmail',
    GMAIL_SEND_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: rawEmail(f.to, f.subject, f.body) }),
    },
    fetchImpl,
  );
  if (!res.ok) throw new Error(`Gmail refused the email (${res.status})`);
}

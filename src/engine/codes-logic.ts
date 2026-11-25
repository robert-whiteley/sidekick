/**
 * What a scanned QR code or barcode holds, and what can be done with it: a link (shown first,
 * opened only on tap), Wi-Fi (the system "save network" sheet), a contact (the Contacts app,
 * prefilled), a phone number, an email, or text / a product number to copy. Pure; tested in
 * __tests__/codes-logic-test.ts.
 */

export type ScannedCode = { format: string; text: string };

export type CodeContent =
  | { kind: 'url'; url: string }
  | {
      kind: 'wifi';
      ssid: string;
      password: string | null;
      security: 'WPA' | 'WEP' | 'SAE' | 'nopass';
      hidden: boolean;
    }
  | { kind: 'contact'; name: string; phone?: string; email?: string; org?: string }
  | { kind: 'phone'; number: string }
  | { kind: 'email'; to: string; subject?: string }
  | { kind: 'product'; number: string; format: string }
  | { kind: 'text'; text: string };

/** Unescapes a WIFI:/MECARD: field ("\;" → ";"). */
const unesc = (s: string) => s.replace(/\\([\\;,:"])/g, '$1');

/** Splits "K:v;K2:v2;;" honouring backslash escapes. */
function fields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur = '';
  const parts: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) {
      cur += c + body[++i];
    } else if (c === ';') {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur) parts.push(cur);
  for (const p of parts) {
    const k = p.indexOf(':');
    if (k > 0) out[p.slice(0, k).toUpperCase()] ??= unesc(p.slice(k + 1));
  }
  return out;
}

export function parseCode(code: ScannedCode): CodeContent {
  const t = code.text.trim();
  if (/^(EAN_13|EAN_8|UPC_A|UPC_E|ITF)$/.test(code.format) && /^\d{6,14}$/.test(t))
    return { kind: 'product', number: t, format: code.format };
  if (/^https?:\/\/\S+$/i.test(t)) return { kind: 'url', url: t };
  if (/^www\.\S+\.\S+$/i.test(t)) return { kind: 'url', url: `https://${t}` };
  if (/^WIFI:/i.test(t)) {
    const f = fields(t.slice(5));
    const sec = (f.T ?? '').toUpperCase();
    return {
      kind: 'wifi',
      ssid: f.S ?? '',
      password: f.P ? f.P : null,
      security:
        sec === 'WEP'
          ? 'WEP'
          : sec === 'SAE' || sec === 'WPA3'
            ? 'SAE'
            : sec.startsWith('WPA')
              ? 'WPA'
              : f.P
                ? 'WPA'
                : 'nopass',
      hidden: /^true$/i.test(f.H ?? ''),
    };
  }
  if (/^MECARD:/i.test(t)) {
    const f = fields(t.slice(7));
    const name = (f.N ?? '').split(',').reverse().join(' ').trim();
    return { kind: 'contact', name, phone: f.TEL, email: f.EMAIL, org: f.ORG };
  }
  if (/^BEGIN:VCARD/i.test(t)) {
    const line = (k: string) =>
      new RegExp(`^${k}(?:;[^:\\r\\n]*)?:(.*)$`, 'im').exec(t)?.[1]?.trim() || undefined;
    const n = line('N');
    const name = line('FN') ?? (n ? n.split(';').slice(0, 2).reverse().join(' ').trim() : '');
    return {
      kind: 'contact',
      name: name ?? '',
      phone: line('TEL'),
      email: line('EMAIL'),
      org: line('ORG'),
    };
  }
  let m: RegExpExecArray | null;
  if ((m = /^tel:(\+?[\d ()-]{3,})$/i.exec(t))) return { kind: 'phone', number: m[1].trim() };
  if ((m = /^mailto:([^?\s]+)(?:\?(.*))?$/i.exec(t))) {
    const subject = m[2] ? (new URLSearchParams(m[2]).get('subject') ?? undefined) : undefined;
    return { kind: 'email', to: decodeURIComponent(m[1]), subject };
  }
  if ((m = /^MATMSG:TO:([^;]+);(?:SUB:([^;]*);)?/i.exec(t)))
    return { kind: 'email', to: m[1], subject: m[2] || undefined };
  return { kind: 'text', text: t };
}

/** The host a link goes to, shown before opening ("example.com"). */
export function linkHost(url: string): string {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return m ? m[1].replace(/^www\./, '') : url;
}

export type CodeButton = 'open' | 'wifi' | 'contact' | 'call' | 'email' | 'copy';

/** What to say about a code and the buttons on its card (Open is never automatic). */
export function describeCode(c: CodeContent): { text: string; buttons: CodeButton[] } {
  switch (c.kind) {
    case 'url':
      return { text: `It's a link to ${linkHost(c.url)}: ${c.url}`, buttons: ['open', 'copy'] };
    case 'wifi':
      return {
        text: `It's the Wi-Fi network "${c.ssid}"${c.password ? ' with a password' : ' (open)'}.`,
        buttons: ['wifi', ...(c.password ? (['copy'] as const) : [])],
      };
    case 'contact':
      return {
        text: `It's a contact card for ${c.name || 'someone'}${c.phone ? `, ${c.phone}` : ''}${c.email ? `, ${c.email}` : ''}.`,
        buttons: ['contact', 'copy'],
      };
    case 'phone':
      return { text: `It's the phone number ${c.number}.`, buttons: ['call', 'copy'] };
    case 'email':
      return { text: `It's an email address: ${c.to}.`, buttons: ['email', 'copy'] };
    case 'product':
      return { text: `It's a product barcode: ${c.number}.`, buttons: ['copy'] };
    default: {
      const t = c.text.length > 300 ? `${c.text.slice(0, 300)}…` : c.text;
      return { text: `It says: "${t}"`, buttons: ['copy'] };
    }
  }
}

/** What Copy puts on the clipboard. */
export function copyText(c: CodeContent): string {
  switch (c.kind) {
    case 'url':
      return c.url;
    case 'wifi':
      return c.password ?? c.ssid;
    case 'contact':
      return [c.name, c.phone, c.email].filter(Boolean).join(', ');
    case 'phone':
      return c.number;
    case 'email':
      return c.to;
    case 'product':
      return c.number;
    default:
      return c.text;
  }
}

/** A line for the model when a photo question's picture has a code in it. */
export function codePromptLine(codes: CodeContent[]): string {
  if (!codes.length) return '';
  return `Codes read in the picture: ${codes.map((c) => describeCode(c).text).join(' ')}\n`;
}

import {
  codePromptLine,
  copyText,
  describeCode,
  linkHost,
  parseCode,
} from '../src/engine/codes-logic';

const qr = (text: string) => parseCode({ format: 'QR_CODE', text });

describe('scanned codes', () => {
  it('links are shown first, never opened by themselves', () => {
    const c = qr('https://www.example.com/menu?t=4');
    expect(c).toEqual({ kind: 'url', url: 'https://www.example.com/menu?t=4' });
    expect(describeCode(c).text).toMatch(/link to example.com/);
    expect(describeCode(c).buttons).toEqual(['open', 'copy']);
    expect(qr('www.example.org')).toEqual({ kind: 'url', url: 'https://www.example.org' });
    expect(linkHost('https://a.b.com:8080/x')).toBe('a.b.com');
  });
  it('Wi-Fi with escapes', () => {
    const c = qr(String.raw`WIFI:T:WPA;S:Cafe\;Guest;P:pa\:ss;H:false;;`);
    expect(c).toEqual({
      kind: 'wifi',
      ssid: 'Cafe;Guest',
      password: 'pa:ss',
      security: 'WPA',
      hidden: false,
    });
    expect(describeCode(c).buttons).toEqual(['wifi', 'copy']);
    expect(copyText(c)).toBe('pa:ss');
    expect(qr('WIFI:S:Open;;')).toMatchObject({ security: 'nopass', password: null });
  });
  it('contacts (MECARD and vCard)', () => {
    expect(qr('MECARD:N:Smith,Jo;TEL:+441234;EMAIL:jo@example.com;;')).toEqual({
      kind: 'contact',
      name: 'Jo Smith',
      phone: '+441234',
      email: 'jo@example.com',
      org: undefined,
    });
    const v = qr(
      'BEGIN:VCARD\nVERSION:3.0\nN:Lee;Sam\nFN:Sam Lee\nTEL;TYPE=CELL:+44 7700 900123\nORG:Acme\nEND:VCARD',
    );
    expect(v).toMatchObject({
      kind: 'contact',
      name: 'Sam Lee',
      phone: '+44 7700 900123',
      org: 'Acme',
    });
  });
  it('phone, email, product, text', () => {
    expect(qr('tel:+44 20 7946 0000')).toEqual({ kind: 'phone', number: '+44 20 7946 0000' });
    expect(qr('mailto:hi@example.com?subject=Hello%20there')).toEqual({
      kind: 'email',
      to: 'hi@example.com',
      subject: 'Hello there',
    });
    const p = parseCode({ format: 'EAN_13', text: '5012345678900' });
    expect(p).toEqual({ kind: 'product', number: '5012345678900', format: 'EAN_13' });
    expect(describeCode(qr('Table 12')).text).toBe('It says: "Table 12"');
    expect(codePromptLine([])).toBe('');
    expect(codePromptLine([p])).toMatch(/^Codes read in the picture: .*5012345678900.*\n$/);
  });
});

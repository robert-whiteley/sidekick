/** Apple rejects App Intent titles, descriptions and phrases that name its products (ITMS-90626). */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(__dirname, '..', 'app-intents');
const BANNED = /\b(iphone|ipad|ipod|apple|siri|mac|ios|watchos|airpods)\b/i;

describe('App Intents text', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.swift'));
  it('has intent files', () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(`${f} names no Apple product in user-facing strings`, () => {
      const lines = fs
        .readFileSync(path.join(DIR, f), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'));
      const strings = lines.flatMap((l) => l.match(/"(?:[^"\\]|\\.)*"/g) ?? []);
      expect(strings.filter((s) => BANNED.test(s))).toEqual([]);
    });
  }
});

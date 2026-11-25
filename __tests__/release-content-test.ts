import { CHANGELOG } from '@/content/changelog';
import { feedbackBody, feedbackMailto } from '@/content/feedback';
import { PRIVACY_POLICY_MD, THIRD_PARTY_NOTICES_MD } from '@/content/legal';
import { parseMarkdown, plain } from '@/content/markdown-lite';
import {
  compareVersions,
  entriesSince,
  playStoreText,
  shouldShowWhatsNew,
} from '@/content/whats-new';

declare const __dirname: string;
const fs = jest.requireActual<{ readFileSync: (p: string, enc: 'utf8') => string }>('fs');
const root = `${__dirname}/..`;
const readFileSync = fs.readFileSync;
const join = (...p: string[]) => p.join('/');
const log = [
  { version: '1.2.0', date: '2026-12-10', items: ['C'] },
  { version: '1.1.0', date: '2026-12-01', items: ['B'] },
  { version: '1.0.0', date: '2026-11-25', items: ['A'] },
];

describe('whats new', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });
  it('is not shown on a fresh install or the same version', () => {
    expect(shouldShowWhatsNew(null, '1.2.0', log)).toBe(false);
    expect(shouldShowWhatsNew('1.2.0', '1.2.0', log)).toBe(false);
    expect(shouldShowWhatsNew('1.2.0', '1.1.0', log)).toBe(false);
  });
  it('is shown once after an update that has notes', () => {
    expect(shouldShowWhatsNew('1.0.0', '1.2.0', log)).toBe(true);
    expect(shouldShowWhatsNew('1.2.0', '1.2.1', log)).toBe(false); // no notes for 1.2.1
  });
  it('lists the versions since the last one seen', () => {
    expect(entriesSince('1.0.0', '1.2.0', log).map((e) => e.version)).toEqual(['1.2.0', '1.1.0']);
  });
  it('keeps Play text within 500 characters', () => {
    const long = { version: '9', date: '', items: Array(20).fill('x'.repeat(40)) };
    expect(playStoreText(long).length).toBeLessThanOrEqual(500);
    expect(playStoreText(log[0])).toBe('• C');
  });
  it('bundled changelog is newest first, dated, with plain short lines', () => {
    for (let i = 1; i < CHANGELOG.length; i++)
      expect(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBeGreaterThan(0);
    const appVersion = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.version;
    expect(CHANGELOG[0].version).toBe(appVersion);
    for (const e of CHANGELOG) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.items.length).toBeGreaterThan(0);
      expect(playStoreText(e).split('\n')).toHaveLength(e.items.length);
    }
  });
});

describe('legal texts', () => {
  it('match the repo files (run node scripts/build-legal.mjs if this fails)', () => {
    expect(PRIVACY_POLICY_MD).toBe(readFileSync(join(root, 'docs/privacy-policy.md'), 'utf8'));
    expect(THIRD_PARTY_NOTICES_MD).toBe(readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'));
  });
  it('parses headings, lists, tables and links', () => {
    const b = parseMarkdown(
      '# T\n\nSome **bold**\ntext.\n\n- one\n  more\n\n| A | B |\n| - | - |\n| x | [y](https://y.org) |\n',
    );
    expect(b).toEqual([
      { type: 'heading', level: 1, text: 'T' },
      { type: 'paragraph', text: 'Some bold text.' },
      { type: 'item', depth: 0, text: 'one more' },
      { type: 'row', cells: ['A', 'B'] },
      { type: 'row', cells: ['x', 'y (https://y.org)'] },
    ]);
    expect(plain('[https://a.b](https://a.b) `c`')).toBe('https://a.b c');
  });
  it('licences list has a row for every library table entry', () => {
    const rows = parseMarkdown(THIRD_PARTY_NOTICES_MD).filter((x) => x.type === 'row');
    expect(rows.length).toBeGreaterThan(20);
  });
});

describe('feedback email', () => {
  const info = { version: '1.0.0', build: '7', device: 'Google Pixel 5', os: 'Android 14' };
  it('prefills only version and phone model', () => {
    expect(feedbackBody(info)).toBe(
      '\n\n— Added by Sidekick (edit or delete freely) —\nSidekick 1.0.0 (7)\nPhone: Google Pixel 5, Android 14',
    );
  });
  it('builds a mailto link', () => {
    const url = feedbackMailto('help@example.org', info);
    expect(url.startsWith('mailto:help%40example.org?subject=Sidekick%20feedback&body=')).toBe(
      true,
    );
    expect(decodeURIComponent(url.split('body=')[1])).toBe(feedbackBody(info));
  });
});

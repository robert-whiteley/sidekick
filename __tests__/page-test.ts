import { fetchPage } from '@/web/page';
import { decodeEntities, extractPage, readableUrl, siteOf } from '@/web/page-logic';

const ARTICLE = `<!doctype html><html><head><title>Otter - Wikipedia</title>
<style>.x{color:red}</style><script>var a = "<p>no</p>";</script></head>
<body><nav><ul><li><a href="/">Home</a></li><li><a href="/a">About</a></li></ul></nav>
<header>Site header</header>
<main><h1>Otter</h1>
<p>Otters are carnivorous mammals in the subfamily Lutrinae.<sup class="reference">[1]</sup> There are 14 extant otter species, all semiaquatic.</p>
<p>They eat fish &amp; shellfish, and some use stones as tools to open shells &mdash; a rare skill.</p>
<div style="display:none"><p>Hidden text that should not appear.</p></div>
<p><a href="/1">Link</a> <a href="/2">Link</a> <a href="/3">Link</a></p>
</main><footer>Footer stuff</footer></body></html>`;

describe('reading a web page', () => {
  it('keeps the main text and drops menus, scripts, notes and hidden parts', () => {
    const { title, text } = extractPage(ARTICLE);
    expect(title).toBe('Otter - Wikipedia');
    expect(text).toContain('Otters are carnivorous mammals');
    expect(text).toContain('fish & shellfish');
    for (const bad of ['Home', 'Site header', 'Footer', 'no</p>', '[1]', 'Hidden', 'color:red'])
      expect(text).not.toContain(bad);
  });
  it('decodes entities', () => {
    expect(decodeEntities('a&nbsp;b &lt;c&gt; &#39;d&#x27;')).toBe("a b <c> 'd'");
  });
  it('only reads public web addresses', () => {
    expect(readableUrl('https://en.wikipedia.org/wiki/Otter')).toBe(true);
    for (const u of [
      'http://localhost:8080',
      'http://192.168.1.4/', // privacy-allow: made-up private address
      'http://10.0.0.1', // privacy-allow
      'file:///x',
    ])
      expect(readableUrl(u)).toBe(false);
    expect(siteOf('https://en.wikipedia.org/wiki/Otter')).toContain('wikipedia.org');
  });
  it('fetches only that page, without cookies', async () => {
    const doFetch = jest.fn(async () => ({
      ok: true,
      url: 'https://en.wikipedia.org/wiki/Otter',
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => ARTICLE,
    })) as unknown as typeof fetch;
    const r = await fetchPage('https://en.wikipedia.org/wiki/Otter', doFetch);
    expect(r.ok).toBe(true);
    expect((doFetch as jest.Mock).mock.calls[0][1].credentials).toBe('omit');
    const offline = jest.fn(async () => {
      throw new Error('net');
    }) as unknown as typeof fetch;
    expect(await fetchPage('https://a.org/x', offline)).toEqual({ ok: false, reason: 'offline' });
    expect((await fetchPage('http://127.0.0.1/', doFetch)).ok).toBe(false);
  });
});

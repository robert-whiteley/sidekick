import {
  cleanArticle,
  cleanReport,
  decodeEntities,
  fallbackQueries,
  fetchablePage,
  htmlToText,
  MAX_QUERIES,
  parsePlan,
  parseWikipediaArticle,
  passagesOf,
  pickPassages,
  REPORT_SOURCE_CHARS,
  reportPrompt,
  reportSources,
  RESEARCH_OFFLINE,
  termsOf,
  wikipediaArticleUrl,
  wikipediaTitle,
} from '@/web/research-logic';
import { relevantTools } from '@/engine/tools-logic';
import type { WebSource } from '@/web/lookup-logic';

jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock('@/memory/store', () => ({ listSpeakers: jest.fn() }));
jest.mock('@/engine/settings', () => ({ getSettings: jest.fn() }));
jest.mock('@/engine/prompts', () => ({ SYSTEM_PROMPT: 'sys' }));
jest.mock('@/engine/llm', () => ({
  askLlm: jest.fn(),
  askLlmAside: jest.fn(),
  cancelLlm: jest.fn(),
  ensureLlm: jest.fn(),
}));

// eslint-disable-next-line import/first
import { fetchPage, readSource, research, type ResearchDeps, stopResearch } from '@/web/research';

const src = (name: string, url: string, text = 'snippet'): WebSource => ({
  name,
  title: name,
  url,
  text,
});

describe('parsePlan', () => {
  test('JSON object, cleaned, names out, deduped, capped', () => {
    const q = parsePlan(
      '```json\n{"queries":["heat pump running costs UK","\\"heat pump\\" vs gas boiler","Heat pump running costs UK","Sam heat pump grants","a","noise of heat pumps","fifth one"]}\n```',
      ['Sam'],
    );
    expect(q).toEqual([
      'heat pump running costs UK',
      'heat pump vs gas boiler',
      'heat pump grants',
      'noise of heat pumps',
    ]);
    expect(q.length).toBeLessThanOrEqual(MAX_QUERIES);
  });
  test('a bare list or numbered lines also work', () => {
    expect(parsePlan('["bees decline causes", "pesticides bees"]', [])).toEqual([
      'bees decline causes',
      'pesticides bees',
    ]);
    expect(parsePlan('1. bees decline causes\n2) pesticides bees\n- varroa mite', [])).toEqual([
      'bees decline causes',
      'pesticides bees',
      'varroa mite',
    ]);
  });
  test('nothing usable', () => {
    expect(parsePlan("Sorry, I can't help with that.", [])).toEqual([]);
    expect(parsePlan('', [])).toEqual([]);
  });
});

test('fallbackQueries strips the request words and names', () => {
  expect(fallbackQueries('Research the history of the bicycle for Sam', ['Sam'])).toEqual([
    'the history of the bicycle for',
    'history bicycle',
  ]);
  expect(fallbackQueries('Can you do some research on tidal power?', [])).toEqual(['tidal power']);
  expect(fallbackQueries('?', [])).toEqual([]);
});

describe('pages', () => {
  test('wikipedia titles and article URL', () => {
    expect(wikipediaTitle('https://en.wikipedia.org/wiki/Heat_pump')).toEqual({
      lang: 'en',
      title: 'Heat pump',
    });
    expect(wikipediaTitle('https://en.m.wikipedia.org/wiki/Caf%C3%A9')?.title).toBe('Café');
    expect(wikipediaTitle('https://example.com/wiki/X')).toBeNull();
    expect(wikipediaArticleUrl('en', 'Heat pump')).toContain('titles=Heat+pump');
    expect(parseWikipediaArticle({ query: { pages: [{ extract: 'Body' }] } })).toBe('Body');
    expect(parseWikipediaArticle(null)).toBe('');
  });
  test('only plain public https pages are fetched', () => {
    expect(fetchablePage('https://www.example.org/a')).toBe(true);
    expect(fetchablePage('http://example.org/a')).toBe(false);
    expect(fetchablePage('https://user:pw@example.org/')).toBe(false);
    expect(fetchablePage('https://192.168.1.1/')).toBe(false); // privacy-allow (example private address)
    expect(fetchablePage('https://localhost/')).toBe(false);
    expect(fetchablePage('https://duckduckgo.com/')).toBe(false);
    expect(fetchablePage('not a url')).toBe(false);
  });
  test('htmlToText keeps the article paragraphs only', () => {
    const html = `<html><head><title>t</title><script>var x = "<p>no</p>";</script></head><body>
      <nav><p>Home News Sport and a long menu line that is more than forty chars</p></nav>
      <article><h2>Costs</h2><p>A heat pump costs about &pound;7,000 to fit, though grants of &#163;7,500 exist &amp; help.</p>
      <p>Short line.</p><p>We use cookies to improve your experience on this site.</p>
      <li>Running costs are similar to a modern gas boiler in most homes today.</li>
      ${'<p>Filler paragraph that is long enough to keep the article above the size floor.</p>'.repeat(8)}
      </article><footer><p>Copyright notice that is long enough to pass the length check.</p></footer></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain('## Costs');
    expect(t).toContain('grants of £7,500 exist & help.');
    expect(t).toContain('Running costs are similar');
    expect(t).not.toMatch(/Short line|cookies|menu|Copyright|no<\/p>/);
  });
  test('decodeEntities', () => {
    expect(decodeEntities('a&nbsp;b &#x2014; &quot;c&quot; &unknown;')).toBe('a b — "c" &unknown;');
  });
  test('cleanArticle drops the reference sections and marks headings', () => {
    const t = cleanArticle(
      'Intro text.\n\n== History ==\nOld text.\n\n== See also ==\nList\n== References ==\nRefs',
    );
    expect(t).toBe('Intro text.\n## History\nOld text.');
  });
  test('passagesOf splits long paragraphs and tags headings', () => {
    const long = 'This is a sentence about tides and power. '.repeat(30);
    const p = passagesOf(`## Tidal power\n${long}`);
    expect(p.length).toBeGreaterThan(2);
    expect(p[0].startsWith('(Tidal power) ')).toBe(true);
    expect(p.every((x) => x.length <= 440)).toBe(true);
  });
});

test('termsOf', () => {
  expect(termsOf('Research the pros and cons of heat pumps')).toEqual(['heat', 'pumps', 'pump']);
});

describe('pickPassages', () => {
  const page = (name: string, text: string, query = 'q') => ({
    source: src(name, `https://${name}.org/`),
    query,
    text,
  });
  test('every source gets its best passage, within the budget', () => {
    const a = page(
      'a',
      'Bees pollinate crops worth billions.\nUnrelated text about cars and roads here and there.\nVarroa mites spread viruses among bees and weaken colonies badly.',
      'varroa mites',
    );
    const b = page('b', 'Pesticides called neonicotinoids harm bees in many studies since 2013.');
    const c = {
      source: src('c', 'https://c.org/', 'Snippet about bees decline.'),
      query: 'q',
      text: '',
    };
    const picked = pickPassages([a, b, c], 'why are bees declining');
    expect(picked.map((p) => p.source.name)).toEqual(['a', 'b', 'c']);
    expect(picked[0].passages.join(' ')).toContain('Varroa');
    expect(picked[0].passages.join(' ')).not.toContain('cars');
    expect(picked[2].passages).toEqual(['Snippet about bees decline.']);
    const total = picked.flatMap((p) => p.passages).join('').length;
    expect(total).toBeLessThanOrEqual(REPORT_SOURCE_CHARS);
  });
  test('budget is respected with long pages', () => {
    const text = Array.from(
      { length: 60 },
      (_, i) =>
        `Heat pumps fact number ${i} says heat pumps move heat from outside air into homes.`,
    ).join('\n');
    const picked = pickPassages(
      [page('a', text), page('b', text), page('c', text)],
      'heat pumps',
      1500,
    );
    expect(picked.flatMap((p) => p.passages).join('').length).toBeLessThanOrEqual(1500);
  });
});

test('report prompt numbers sources; sources keep their number; bad citations go', () => {
  const picked = [
    {
      source: { ...src('Wikipedia', 'https://en.wikipedia.org/wiki/Bee'), title: 'Bee' },
      passages: ['P1'],
    },
    {
      source: {
        ...src('GDELT', 'https://news.example/x'),
        domain: 'news.example',
        date: '2026-11-20',
      },
      passages: ['P2'],
    },
  ];
  const p = reportPrompt('why are bees declining', picked, new Date('2026-11-26T10:00:00Z'));
  expect(p).toContain('[1] Bee (en.wikipedia.org)\nP1');
  expect(p).toContain('[2] GDELT (news.example, 2026-11-20)\nP2');
  expect(p).toContain('request: why are bees declining');
  expect(reportSources(picked).map((s) => s.ref)).toEqual([1, 2]);
  expect(cleanReport('Bees decline [1]. Mites [2, 7]. Made up [9].  \n- x', 2)).toBe(
    'Bees decline [1]. Mites [2]. Made up .\n- x',
  );
});

describe('router offers research for research requests', () => {
  test.each([
    'Research the history of the bicycle',
    'Look into whether heat pumps work in old houses',
    'Do some research on tidal power and write me a report',
    'Find out everything about the James Webb telescope',
    'Compare electric and petrol cars on running costs',
  ])('%s', (q) => {
    expect(relevantTools(q).map((t) => t.name)).toContain('research');
  });
  test('plain questions go the normal way', () => {
    expect(relevantTools('What is the capital of France?')).toEqual([]);
  });
});

describe('research()', () => {
  const deps = (over: Partial<ResearchDeps> = {}): ResearchDeps => ({
    enabled: () => true,
    online: async () => true,
    knownNames: async () => ['Sam'],
    ask: jest.fn(async (prompt: string, _max: number, onText?: (t: string) => void) => {
      if (prompt.includes('Plan web research'))
        return '{"queries":["tidal power how it works","tidal power UK sites"]}';
      onText?.('Tidal power uses tides [1].');
      return 'Tidal power uses tides [1]. Sites exist [2]. Wrong [5].';
    }),
    search: jest.fn(async (q: string) =>
      q.includes('UK')
        ? [
            src('GDELT', 'https://news.example/uk', 'UK sites'),
            src('Wikipedia', 'https://en.wikipedia.org/wiki/Tidal_power'),
          ]
        : [src('Wikipedia', 'https://en.wikipedia.org/wiki/Tidal_power', 'Tidal power intro')],
    ),
    read: jest.fn(async (s: WebSource) =>
      s.url.includes('wikipedia')
        ? 'Tidal power converts the energy of tides into electricity.\nThe Sihwa plant is the largest tidal power station.'
        : 'The UK has several tidal power sites including the Severn estuary proposals.',
    ),
    searxUrl: () => '',
    feeds: () => [],
    now: () => new Date('2026-11-26T10:00:00Z'),
    ...over,
  });

  test('plans, searches each query, reads unique pages, writes a cited report', async () => {
    const d = deps();
    const status: string[] = [];
    const shown: string[] = [];
    const r = await research(
      'Research tidal power',
      (t) => shown.push(t),
      (l) => status.push(l),
      d,
    );
    expect(r.queries).toEqual(['tidal power how it works', 'tidal power UK sites']);
    expect(d.search).toHaveBeenCalledTimes(2);
    expect(d.read).toHaveBeenCalledTimes(2); // the Wikipedia page once
    expect(r.web.map((w) => w.ref)).toEqual([1, 2]);
    expect(r.text).toBe('Tidal power uses tides [1]. Sites exist [2]. Wrong .');
    expect(status[0]).toBe('Planning the research…');
    expect(status).toContain('Searching 1 of 2: tidal power how it works…');
    expect(status).toContain('Searching 2 of 2: tidal power UK sites…');
    expect(status.some((s) => /^Reading 2 of 2: /.test(s))).toBe(true);
    expect(status[status.length - 1]).toBe('Writing the report from 2 sources…');
    expect(shown[shown.length - 1]).toBe(r.text);
    expect(r.pagesRead).toBe(2);
  });

  test('short Wikimedia budget: one search, no Wikipedia page read', async () => {
    const d = deps({ wikiLeft: () => 0 });
    const r = await research(
      'Research tidal power',
      () => {},
      () => {},
      d,
    );
    expect(d.search).toHaveBeenCalledTimes(1);
    expect(d.read).not.toHaveBeenCalled();
    // The Wikipedia hit's search snippet is still used, with no request for the page.
    expect(r.web.map((w) => w.url)).toEqual(['https://en.wikipedia.org/wiki/Tidal_power']);
  });

  test('a page that cannot be read still gives its search snippet', async () => {
    const r = await research(
      'Research tidal power',
      () => {},
      () => {},
      deps({ read: jest.fn(async () => '') }),
    );
    expect(r.web.length).toBeGreaterThan(0);
  });

  test('offline setting and no internet answer at once, without the model', async () => {
    const d = deps({ enabled: () => false });
    const r = await research(
      'Research tides',
      () => {},
      () => {},
      d,
    );
    expect(r.text).toBe(RESEARCH_OFFLINE);
    expect(r.local).toBe(true);
    expect(d.ask).not.toHaveBeenCalled();
    const r2 = await research(
      'Research tides',
      () => {},
      () => {},
      deps({ online: async () => false }),
    );
    expect(r2.local).toBe(true);
  });

  test('unusable plan falls back to the request words; names never sent', async () => {
    const d = deps({
      ask: jest.fn(async (p: string) => (p.includes('Plan web') ? 'no idea' : 'Report [1].')),
    });
    await research(
      'Research tidal power for Sam',
      () => {},
      () => {},
      d,
    );
    expect((d.search as jest.Mock).mock.calls[0][0]).toBe('tidal power for');
  });

  test('nothing found', async () => {
    const r = await research(
      'Research x y',
      () => {},
      () => {},
      deps({ search: async () => [] }),
    );
    expect(r.local).toBe(true);
  });

  test('stop ends it after the current step', async () => {
    const d = deps({
      search: jest.fn(async () => {
        stopResearch();
        return [src('Wikipedia', 'https://en.wikipedia.org/wiki/A')];
      }),
    });
    const r = await research(
      'Research tidal power',
      () => {},
      () => {},
      d,
    );
    expect(d.search).toHaveBeenCalledTimes(1);
    expect(r.local).toBe(true);
  });
});

describe('fetching', () => {
  const res = (body: string, type = 'text/html', ok = true, url = 'https://x.org/') =>
    ({
      ok,
      url,
      headers: { get: (k: string) => (k === 'content-type' ? type : null) },
      text: async () => body,
    }) as unknown as Response;
  test('fetchPage: html only, https only, no credentials', async () => {
    const f = jest.fn(async () => res('<p>hi</p>'));
    expect(await fetchPage('https://x.org/', 1000, f as unknown as typeof fetch)).toBe('<p>hi</p>');
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].credentials).toBe('omit');
    expect(
      await fetchPage('https://x.org/', 1000, (async () =>
        res('%PDF', 'application/pdf')) as unknown as typeof fetch),
    ).toBeNull();
    expect(
      await fetchPage('https://x.org/', 1000, (async () =>
        res('<p/>', 'text/html', true, 'http://x.org/')) as unknown as typeof fetch),
    ).toBeNull();
    expect(await fetchPage('http://x.org/', 1000, f as unknown as typeof fetch)).toBeNull();
  });
  test('readSource: Wikipedia through the API, others as HTML', async () => {
    const json = jest.fn(async () => ({
      query: { pages: [{ extract: 'Body.\n== References ==\nx' }] },
    }));
    const page = jest.fn(
      async () => '<article><p>' + 'Words about the topic here. '.repeat(30) + '</p></article>',
    );
    expect(await readSource(src('W', 'https://en.wikipedia.org/wiki/Tide'), { json, page })).toBe(
      'Body.',
    );
    expect(json.mock.calls[0]).toBeDefined();
    expect(await readSource(src('N', 'https://news.example/a'), { json, page })).toContain(
      'Words about',
    );
  });
});

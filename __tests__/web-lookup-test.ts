import ddgAbstract from './fixtures/web/ddg-abstract.json';
import ddgAnswer from './fixtures/web/ddg-answer.json';
import searx from './fixtures/web/searxng.json';
import wikiEmpty from './fixtures/web/wikipedia-empty.json';
import wiki from './fixtures/web/wikipedia-search.json';
import {
  buildQuery,
  clipText,
  duckDuckGoUrl,
  mergeSources,
  normaliseSearxUrl,
  parseDuckDuckGo,
  parseSearx,
  parseWikipedia,
  SOURCE_CHARS,
  stripNames,
  webContext,
  wikipediaUrl,
} from '@/web/lookup-logic';

jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock('@/memory/store', () => ({ listSpeakers: jest.fn() }));
jest.mock('@/engine/settings', () => ({ getSettings: jest.fn() }));
jest.mock('@/engine/llm', () => ({
  askLlmAside: jest.fn(),
  cancelLlm: jest.fn(),
  ensureLlm: jest.fn(),
}));

// eslint-disable-next-line import/first
import { askWithLookup, fetchJson, type LookupDeps, searchWeb } from '@/web/lookup';

describe('query building', () => {
  test('strips question words, polite lead-ins and known names', () => {
    expect(buildQuery('Who is the president of France?', [])).toBe('president of France');
    expect(buildQuery('Can you look up the boiling point of ethanol please?', [])).toBe(
      'boiling point of ethanol',
    );
    expect(buildQuery('Search online for Sam Smith songs', ['Sam'])).toBe('Smith songs');
    expect(buildQuery('How tall is Mount Everest?', [])).toBe('Mount Everest');
    expect(buildQuery('Tell me about the Eiffel Tower online', [])).toBe('Eiffel Tower');
  });

  test('stripNames removes possessives and is case-insensitive', () => {
    expect(stripNames("look up priya shah's company and sams' dog", ['Priya Shah', 'Sam'])).toBe(
      'look up company and dog',
    );
    expect(stripNames('Samuel Beckett', ['Sam'])).toBe('Samuel Beckett');
  });

  test('URLs carry only the query', () => {
    const w = new URL(wikipediaUrl('president of France'));
    expect(w.host).toBe('en.wikipedia.org');
    expect(w.searchParams.get('gsrsearch')).toBe('president of France');
    const d = new URL(duckDuckGoUrl('Eiffel Tower'));
    expect(d.searchParams.get('q')).toBe('Eiffel Tower');
    expect(d.searchParams.get('format')).toBe('json');
  });

  test('SearXNG URL must be plain https', () => {
    expect(normaliseSearxUrl('https://searx.example.org/')).toBe('https://searx.example.org');
    expect(normaliseSearxUrl('https://example.org/searx/search')).toBe('https://example.org/searx');
    expect(normaliseSearxUrl('http://searx.example.org')).toBeNull();
    expect(normaliseSearxUrl('https://user:pw@searx.example.org')).toBeNull();
    expect(normaliseSearxUrl('not a url')).toBeNull();
    expect(normaliseSearxUrl('')).toBeNull();
  });
});

describe('parsing recorded responses', () => {
  test('Wikipedia search + extract', () => {
    const r = parseWikipedia(wiki);
    expect(r).toMatchObject({
      name: 'Wikipedia',
      title: 'President of France',
      url: 'https://en.wikipedia.org/wiki/President_of_France',
      licence: 'CC BY-SA 4.0',
    });
    expect(r!.text.length).toBeLessThanOrEqual(SOURCE_CHARS + 1);
    expect(r!.text.startsWith('The president of France')).toBe(true);
    expect(parseWikipedia(wikiEmpty)).toBeNull();
    expect(parseWikipedia(null)).toBeNull();
  });

  test('DuckDuckGo abstract keeps its source; empty answer is null', () => {
    const r = parseDuckDuckGo(ddgAbstract);
    expect(r).toMatchObject({
      name: 'DuckDuckGo / Wikipedia',
      title: 'Eiffel Tower',
      url: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
      licence: 'CC BY-SA 4.0',
    });
    expect(parseDuckDuckGo(ddgAnswer)).toBeNull();
    expect(parseDuckDuckGo({ Answer: '84', Heading: '' })).toMatchObject({ text: '84' });
  });

  test('SearXNG results skip non-http links and are clipped', () => {
    const r = parseSearx(searx);
    expect(r.map((x) => x.name)).toEqual(['rust-lang.org', 'en.wikipedia.org']);
    expect(parseSearx({})).toEqual([]);
  });

  test('merge drops a DuckDuckGo copy of the same Wikipedia page', () => {
    const w = {
      name: 'Wikipedia',
      title: 'Eiffel Tower',
      url: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
      text: 'a',
    };
    const merged = mergeSources([w, parseDuckDuckGo(ddgAbstract), parseSearx(searx)]);
    expect(merged.map((m) => m.name)).toEqual(['Wikipedia', 'rust-lang.org', 'en.wikipedia.org']);
  });

  test('clipText ends on a sentence or word', () => {
    expect(clipText('One. Two. Three.', 100)).toBe('One. Two. Three.');
    expect(clipText('Aaaa bbbb. Cccc dddd eeee ffff', 20)).toBe('Aaaa bbbb.');
    expect(clipText('word '.repeat(20), 22)).toBe('word word word word…');
  });

  test('prompt part names the source and date', () => {
    const p = webContext([parseWikipedia(wiki)!], new Date('2026-11-23T10:00:00Z'));
    expect(p).toContain('Today is 2026-11-23');
    expect(p).toContain('[Wikipedia: President of France]');
    expect(webContext([], new Date())).toBe('');
  });
});

describe('fetch and orchestration', () => {
  const stats = (ms: number) => ({ totalMs: ms, ttftMs: ms / 2 });
  const deps = (over: Partial<LookupDeps> = {}): LookupDeps => ({
    enabled: () => true,
    searxUrl: () => '',
    feeds: () => [],
    knownNames: async () => ['Sam'],
    online: async () => true,
    search: jest.fn(async () => [parseWikipedia(wiki)!]),
    writeQuery: async () => null,
    now: () => new Date('2026-11-23T00:00:00Z'),
    ...over,
  });
  const build = (web: string) => `${web}Question: q`;

  test('off: one offline ask, nothing searched', async () => {
    const d = deps({ enabled: () => false });
    const ask = jest.fn(async (p: string) => ({ text: 'a', stats: stats(10), prompt: p }));
    const r = await askWithLookup(
      'Who is the president of France?',
      false,
      build,
      ask,
      () => {},
      d,
    );
    expect(r.web).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toBe('Question: q');
    expect(d.search).not.toHaveBeenCalled();
  });

  test('not asked for: one plain answer, nothing searched', async () => {
    const d = deps();
    const ask = jest.fn(async (p: string) => ({ text: 'a', stats: stats(10), prompt: p }));
    const r = await askWithLookup('Why do cats purr?', false, build, ask, () => {}, d);
    expect(r.web).toEqual([]);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toBe('Question: q');
    expect(d.search).not.toHaveBeenCalled();
  });

  test('the model asked for a lookup: only the question words are searched', async () => {
    const d = deps();
    const ask = jest.fn(async () => ({ text: 'Macron.', stats: stats(10) }));
    const r = await askWithLookup(
      'Who is the president of France?',
      false,
      build,
      ask,
      () => {},
      d,
      undefined,
      undefined,
      { force: true },
    );
    expect(d.search).toHaveBeenCalledWith(
      'president of France',
      expect.objectContaining({ searx: '', news: false, feeds: [] }),
    );
    expect(r.webQuery).toBe('president of France');
    expect(r.web[0].name).toBe('Wikipedia');
    expect((ask.mock.calls[0] as unknown[])[0]).toContain('[Wikipedia: President of France]');
  });

  test('online by Android but no server reached: marked offline (kept for later)', async () => {
    const d = deps({ search: jest.fn(async () => []), unreachable: () => true });
    const ask = jest.fn(async () => ({ text: 'a', stats: stats(10) }));
    const r = await askWithLookup(
      'Who is the president of France?',
      false,
      build,
      ask,
      () => {},
      d,
      undefined,
      undefined,
      { force: true },
    );
    expect(r.offline).toBe(true);
    const found = deps({ search: jest.fn(async () => []), unreachable: () => false });
    const r2 = await askWithLookup(
      'Who is the president of France?',
      false,
      build,
      ask,
      () => {},
      found,
      undefined,
      undefined,
      { force: true },
    );
    expect(r2.offline).toBe(false);
  });

  test('no network: offline answer', async () => {
    const d = deps({ online: async () => false });
    const ask = jest.fn(async () => ({ text: 'a', stats: stats(10) }));
    const r = await askWithLookup(
      'Who is the president of France?',
      false,
      build,
      ask,
      () => {},
      d,
      undefined,
      undefined,
      { force: true },
    );
    expect(r.web).toEqual([]);
    expect(d.search).not.toHaveBeenCalled();
    expect((ask.mock.calls[0] as unknown[])[0]).toContain('could not check');
  });

  test('news and follow-ups: the model reading is passed on', async () => {
    const writeQuery = jest.fn(async () => 'mars rover landing date');
    const d = deps({ writeQuery });
    const ask = jest.fn(async () => ({ text: 'a', stats: stats(10) }));
    await askWithLookup(
      'and when did it land?',
      false,
      build,
      ask,
      () => {},
      d,
      'what is the new Mars rover called?',
      undefined,
      { force: true, news: true },
    );
    expect(writeQuery).toHaveBeenCalledWith(
      'and when did it land?',
      ['Sam'],
      'what is the new Mars rover called?',
    );
    expect(d.search).toHaveBeenCalledWith(
      'mars rover landing date',
      expect.objectContaining({ news: true }),
    );
  });

  test('searchWeb survives a failing source', async () => {
    const json = async (url: string) => {
      if (url.includes('wikipedia')) throw new Error('down');
      return ddgAbstract;
    };
    const r = await searchWeb(
      'Eiffel Tower',
      { searx: '', news: false, feeds: [], now: new Date() },
      { json, text: async () => null },
    );
    expect(r.map((x) => x.title)).toEqual(['Eiffel Tower']);
  });

  test('fetchJson times out and sends the app User-Agent', async () => {
    jest.useFakeTimers();
    let headers: Record<string, string> = {};
    const hang = ((_u: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Promise((_res, rej) =>
        init.signal!.addEventListener('abort', () => rej(new Error('aborted'))),
      );
    }) as unknown as typeof fetch;
    const p = fetchJson('https://example.org', 4000, hang);
    jest.advanceTimersByTime(4000);
    await expect(p).resolves.toBeNull();
    expect(headers['User-Agent']).toMatch(/^SidekickApp\//);
    jest.useRealTimers();
  });
});

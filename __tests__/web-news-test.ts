import gdelt from './fixtures/web/gdelt-artlist.json';
import eventsMissing from './fixtures/web/wikipedia-current-events-missing.json';
import events from './fixtures/web/wikipedia-current-events.json';
import { cleanModelQuery, decideLookup, modelQueryPrompt, webContext } from '@/web/lookup-logic';
import {
  currentEventsTitle,
  currentEventsUrl,
  feedSources,
  gdeltUrl,
  interleave,
  isNewsQuestion,
  normaliseFeedUrl,
  parseCurrentEvents,
  parseFeed,
  parseGdelt,
  pickMatching,
  safeLink,
  topicWords,
} from '@/web/news-logic';

jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock('@/memory/store', () => ({ listSpeakers: jest.fn(async () => []) }));
jest.mock('@/engine/settings', () => ({ getSettings: jest.fn() }));
jest.mock('@/engine/llm', () => ({
  askLlmAside: jest.fn(),
  cancelLlm: jest.fn(),
  ensureLlm: jest.fn(),
}));

// eslint-disable-next-line import/first
import { askWithLookup, fetchText, type LookupDeps, queryFromModel, searchWeb } from '@/web/lookup';

// Node's fs, typed here: the app's tsconfig has no Node types.
declare const __dirname: string;
const fs = jest.requireActual<{ readFileSync: (p: string, enc: 'utf8') => string }>('fs');
const fixture = (f: string) => fs.readFileSync(`${__dirname}/fixtures/web/${f}`, 'utf8');
const rss = fixture('feed-rss.xml');
const atom = fixture('feed-atom.xml');
const rateLimited = fixture('gdelt-rate-limited.txt');
const NOW = new Date('2026-11-23T22:00:00Z');

describe('news questions', () => {
  test.each([
    ['What is the latest news on COP31?', true],
    ['What happened in Ukraine today?', true],
    ["What's happening with Nvidia?", true],
    ['Any recent headlines about climate?', true],
    ['Who is the president of France?', false],
  ])('%s -> news %s', (q, want) => {
    expect(isNewsQuestion(q)).toBe(want);
  });

  test('news questions are looked up; personal ones still are not', () => {
    const ctx = { enabled: true, photo: false, knownNames: ['Sam'] };
    expect(decideLookup('What happened today?', ctx)).toBe('lookup');
    expect(decideLookup('What did I do today?', ctx)).toBe('none');
    expect(decideLookup("What's the news on Sam?", ctx)).toBe('none');
  });

  test('topic words drop news words and small words', () => {
    expect(topicWords('latest news on the climate summit')).toEqual(['climate', 'summit']);
    expect(topicWords('what happened today')).toEqual([]);
    expect(topicWords('Nvidia CEO')).toEqual(['nvidia', 'ceo']);
  });

  test('matching needs two topic words when there are two', () => {
    const items = ['Climate summit ends', 'Climate of fear', 'Summit of Everest', 'Budget vote'];
    expect(pickMatching(items, ['climate', 'summit'], (x) => x, 5)).toEqual([
      'Climate summit ends',
    ]);
    expect(pickMatching(items, ['budget'], (x) => x, 5)).toEqual(['Budget vote']);
    expect(pickMatching(items, [], (x) => x, 2)).toEqual(items.slice(0, 2));
  });

  test('only web links are kept', () => {
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('intent://x#Intent;end')).toBeNull();
    expect(safeLink('https://a.example/x')).toBe('https://a.example/x');
  });
});

describe('GDELT (recorded 2026-11-23)', () => {
  test('URL: topic words only, English, newest first', () => {
    const u = new URL(gdeltUrl('latest news on the climate summit')!);
    expect(u.host).toBe('api.gdeltproject.org');
    expect(u.searchParams.get('query')).toBe('climate summit sourcelang:english');
    expect(u.searchParams.get('mode')).toBe('ArtList');
    expect(u.searchParams.get('format')).toBe('json');
    expect(u.searchParams.get('sort')).toBe('DateDesc');
    expect(gdeltUrl('what happened today')).toBeNull();
  });

  test('headline, domain, date and link; syndicated copies dropped', () => {
    const r = parseGdelt(gdelt);
    expect(r[0]).toEqual({
      name: 'GDELT',
      title: 'All is not lost, Turkey insists, despite COP31 letdown',
      text: 'All is not lost, Turkey insists, despite COP31 letdown',
      url: 'https://www.theadvocate.com.au/story/9396884/all-is-not-lost-turkey-insists-despite-cop31-letdown/',
      domain: 'theadvocate.com.au',
      date: '2026-11-23',
    });
    // 8 articles, 4 of them the same story.
    expect(r).toHaveLength(5);
  });

  test('rate-limit text or junk is no results', () => {
    expect(parseGdelt(rateLimited)).toEqual([]);
    expect(parseGdelt(null)).toEqual([]);
    expect(parseGdelt({})).toEqual([]);
  });
});

describe('Wikipedia current events (recorded 2026-11-23)', () => {
  test('one request for today and yesterday (UTC)', () => {
    expect(currentEventsTitle(NOW)).toBe('Portal:Current events/2026 November 23');
    const u = new URL(currentEventsUrl(NOW));
    expect(u.host).toBe('en.wikipedia.org');
    expect(u.searchParams.get('titles')).toBe(
      'Portal:Current events/2026 November 23|Portal:Current events/2026 November 22',
    );
  });

  test('matching items, plain text, source link and licence', () => {
    const r = parseCurrentEvents(events, ['nvidia']);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      name: 'Wikipedia Current events',
      url: 'https://www.cbsnews.com/news/nvidia-reinstates-jensen-huang-ceo/',
      domain: 'cbsnews.com',
      date: '2026-11-23',
      licence: 'CC BY-SA 4.0',
    });
    expect(r[0].title.startsWith('Nvidia reinstates Jensen Huang as president')).toBe(true);
    expect(r[0].title).not.toMatch(/\[\[|\]\]|'''|https?:/);
  });

  test('topic lines above an item count for matching', () => {
    const r = parseCurrentEvents(events, topicWords('Russo-Ukrainian war'), 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].date).toBe('2026-11-23'); // newest day first
  });

  test('no topic: the first items of the newest day', () => {
    const r = parseCurrentEvents(events, []);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.date === '2026-11-23')).toBe(true);
  });

  test('missing page is no results', () => {
    expect(parseCurrentEvents(eventsMissing, [])).toEqual([]);
    expect(parseCurrentEvents(null, [])).toEqual([]);
  });
});

describe('user feeds', () => {
  test('https only, no credentials', () => {
    expect(normaliseFeedUrl('https://news.example.org/feed.xml')).toBe(
      'https://news.example.org/feed.xml',
    );
    expect(normaliseFeedUrl('http://news.example.org/feed.xml')).toBeNull();
    expect(normaliseFeedUrl('https://u:p@news.example.org/')).toBeNull();
    expect(normaliseFeedUrl('file:///etc/passwd')).toBeNull();
    expect(normaliseFeedUrl('')).toBeNull();
  });

  test('RSS: CDATA, relative links, guid, entities; bad links skipped', () => {
    const items = parseFeed(rss, 'https://news.example.org/feed.xml');
    expect(items.map((i) => i.title)).toEqual([
      'Nvidia reinstates its chief executive',
      'Climate talks end without a deal at COP31',
      'New battery chemistry — lab results',
    ]);
    expect(items[0]).toEqual({
      title: 'Nvidia reinstates its chief executive',
      url: 'https://news.example.org/2026/11/23/nvidia-ceo',
      date: '2026-11-23',
      feed: 'Example Tech & Science',
    });
    expect(items[1].url).toBe('https://news.example.org/2026/11/22/cop31');
    expect(items[2]).toMatchObject({
      url: 'https://news.example.org/2026/11/21/battery',
      date: '2026-11-21',
    });
  });

  test('Atom: alternate link, escaped title', () => {
    const items = parseFeed(atom, 'https://blog.example.net/atom.xml');
    expect(items).toEqual([
      {
        title: 'Ukraine drone strikes hit Russian refineries',
        url: 'https://blog.example.net/2026/11/23/refineries',
        date: '2026-11-23',
        feed: 'Example Atom Log',
      },
      {
        title: 'Turkey & the PKK: bases withdrawn',
        url: 'http://blog.example.net/2026/11/23/pkk',
        date: '2026-11-23',
        feed: 'Example Atom Log',
      },
    ]);
  });

  test('no entity expansion; junk and huge input are empty', () => {
    const evil =
      '<!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;">]>' +
      '<rss><channel><item><title>&b; &#0; &#x110000; ok</title>' +
      '<link>https://x.example/1</link></item></channel></rss>';
    expect(parseFeed(evil, 'https://x.example/f')[0].title).toBe('&b; ok');
    expect(parseFeed('not xml', 'https://x.example/f')).toEqual([]);
    expect(parseFeed('x'.repeat(1_000_001), 'https://x.example/f')).toEqual([]);
  });

  test('matched to the question words', () => {
    const items = parseFeed(rss, 'https://news.example.org/feed.xml');
    const r = feedSources(items, topicWords('latest on the COP31 climate talks'));
    expect(r.map((x) => x.title)).toEqual(['Climate talks end without a deal at COP31']);
    expect(r[0]).toMatchObject({ name: 'Example Tech & Science', domain: 'news.example.org' });
  });

  test('fetchText refuses a redirect off https and oversized bodies', async () => {
    const res = (url: string, body: string, len?: number) =>
      ({
        ok: true,
        url,
        headers: { get: (h: string) => (h === 'content-length' && len ? String(len) : null) },
        text: async () => body,
      }) as unknown as Response;
    expect(
      await fetchText('https://a.example/f', 1000, (async () =>
        res('https://a.example/f', rss)) as unknown as typeof fetch),
    ).toBe(rss);
    expect(
      await fetchText('https://a.example/f', 1000, (async () =>
        res('http://a.example/f', rss)) as unknown as typeof fetch),
    ).toBeNull();
    expect(
      await fetchText('https://a.example/f', 1000, (async () =>
        res('https://a.example/f', rss, 5_000_000)) as unknown as typeof fetch),
    ).toBeNull();
  });
});

describe('searchWeb with news', () => {
  const opts = { searx: '', news: true, feeds: ['https://news.example.org/feed.xml'], now: NOW };
  const getters = (fail: string[] = []) => {
    const asked: string[] = [];
    return {
      asked,
      json: async (url: string) => {
        asked.push(url);
        if (fail.some((f) => url.includes(f))) throw new Error('down');
        if (url.includes('gdeltproject')) return gdelt;
        if (url.includes('Current+events') || url.includes('Current%20events')) return events;
        return {};
      },
      text: async (url: string) => {
        asked.push(url);
        return fail.includes('feed') ? null : rss;
      },
    };
  };

  test('all sources at once; news first, taking turns', async () => {
    const g = getters();
    const r = await searchWeb('climate COP31', opts, g);
    expect(g.asked.some((u) => u.includes('gdeltproject'))).toBe(true);
    expect(
      g.asked.some((u) =>
        u.includes('wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator'),
      ),
    ).toBe(true);
    expect(g.asked).toContain('https://news.example.org/feed.xml');
    expect(r.map((x) => x.name)).toEqual([
      'Wikipedia Current events',
      'GDELT',
      'Example Tech & Science',
      'GDELT',
    ]);
  });

  test('no topic: no encyclopedia lookups, the day’s events', async () => {
    const g = getters();
    const r = await searchWeb('what happened today', { ...opts, feeds: [] }, g);
    expect(g.asked.every((u) => !u.includes('duckduckgo') && !u.includes('generator'))).toBe(true);
    expect(g.asked.some((u) => u.includes('gdeltproject'))).toBe(false);
    expect(r.length).toBe(2);
    expect(r.every((x) => x.name === 'Wikipedia Current events')).toBe(true);
  });

  test('failing news sources: still answers (offline fallback)', async () => {
    const g = getters(['gdeltproject', 'Current', 'feed', 'duckduckgo', 'wikipedia']);
    await expect(searchWeb('climate COP31', opts, g)).resolves.toEqual([]);
  });

  test('feeds are only read for news questions, and only https ones', async () => {
    const g = getters();
    await searchWeb('Eiffel Tower', { ...opts, news: false }, g);
    expect(g.asked.some((u) => new URL(u).hostname === 'news.example.org')).toBe(false);
    const g2 = getters();
    await searchWeb('climate COP31', { ...opts, feeds: ['http://insecure.example/f'] }, g2);
    expect(g2.asked.some((u) => u.includes('insecure'))).toBe(false);
  });

  test('prompt lines carry source, site and date', () => {
    const p = webContext(parseGdelt(gdelt).slice(0, 1), NOW);
    expect(p).toContain('- [GDELT, theadvocate.com.au, 2026-11-23] All is not lost');
  });

  test('interleave drops repeated links', () => {
    const a = { name: 'a', title: 't', url: 'https://x/1', text: 't' };
    expect(interleave([[a], [a, { ...a, url: 'https://x/2' }]]).map((x) => x.url)).toEqual([
      'https://x/1',
      'https://x/2',
    ]);
  });
});

describe('Gemma writes the search words', () => {
  test('prompt has only the question', () => {
    expect(modelQueryPrompt('  Why do cats purr? ')).toMatch(/Question: Why do cats purr\?$/);
  });

  test.each([
    ['cat purring reasons', 'cat purring reasons'],
    ['"cat purring reasons"\nThis query finds…', 'cat purring reasons'],
    ['Search query: **COP31 climate deal**', 'COP31 climate deal'],
    [
      'Sam Smith latest album release date 2026 news today extra',
      'Smith latest album release date 2026 news today',
    ],
    ['LOOKUP', null],
    ["Sorry, I can't help with that.", null],
    ['', null],
    ['Sam', null],
  ])('%j -> %j', (reply, want) => {
    expect(cleanModelQuery(reply, ['Sam'])).toBe(want);
  });

  test('within budget: the model query is used', async () => {
    const cancel = jest.fn();
    const q = await queryFromModel('q', [], async () => 'cats purring', cancel, 100);
    expect(q).toBe('cats purring');
    expect(cancel).not.toHaveBeenCalled();
  });

  test('too slow: cancelled, waited for, then null', async () => {
    jest.useFakeTimers();
    let finish: (t: string) => void = () => {};
    const cancel = jest.fn(() => finish('late words'));
    const p = queryFromModel(
      'q',
      [],
      () => new Promise<string>((res) => (finish = res)),
      cancel,
      1500,
    );
    await jest.advanceTimersByTimeAsync(1500);
    await expect(p).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('model fails: null', async () => {
    const q = await queryFromModel(
      'q',
      [],
      async () => {
        throw new Error('busy');
      },
      () => {},
    );
    expect(q).toBeNull();
  });

  const deps = (over: Partial<LookupDeps> = {}): LookupDeps => ({
    enabled: () => true,
    searxUrl: () => '',
    feeds: () => ['https://news.example.org/feed.xml'],
    knownNames: async () => ['Sam'],
    online: async () => true,
    search: jest.fn(async () => []),
    writeQuery: jest.fn(async () => 'COP31 climate talks outcome'),
    now: () => NOW,
    ...over,
  });
  const ask = async () => ({ text: 'a', stats: { totalMs: 1, ttftMs: 1 } });

  test('lookup uses Gemma’s words and says it is news', async () => {
    const d = deps();
    const r = await askWithLookup(
      'What happened at COP31?',
      false,
      (w) => w,
      ask,
      () => {},
      d,
    );
    expect(d.writeQuery).toHaveBeenCalledWith('What happened at COP31?', ['Sam']);
    expect(d.search).toHaveBeenCalledWith('COP31 climate talks outcome', {
      searx: '',
      news: true,
      feeds: ['https://news.example.org/feed.xml'],
      now: NOW,
    });
    expect(r.webQuery).toBe('COP31 climate talks outcome');
  });

  test('Gemma gives nothing: rule-based words', async () => {
    const d = deps({ writeQuery: async () => null });
    const r = await askWithLookup(
      'Who is the president of France?',
      false,
      (w) => w,
      ask,
      () => {},
      d,
    );
    expect(r.webQuery).toBe('president of France');
  });

  test('off, offline or personal: Gemma is not asked', async () => {
    for (const [d, q] of [
      [deps({ enabled: () => false }), 'What happened at COP31?'],
      [deps({ online: async () => false }), 'What happened at COP31?'],
      [deps(), 'What did I do today?'],
    ] as const) {
      const r = await askWithLookup(
        q,
        false,
        (w) => w,
        ask,
        () => {},
        d,
      );
      expect(d.writeQuery).not.toHaveBeenCalled();
      expect(d.search).not.toHaveBeenCalled();
      expect(r.webQuery).toBeUndefined();
    }
  });
});

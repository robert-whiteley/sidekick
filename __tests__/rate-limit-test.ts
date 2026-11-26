import { chooseReads, searchesWithin } from '@/web/research-logic';
import {
  isWikimedia,
  politeFetch,
  RateWindow,
  retryAfterMs,
  WIKIMEDIA_PER_MIN,
} from '@/web/rate-limit';

function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    sleep: jest.fn(async (ms: number) => {
      t += ms;
    }),
  };
}
const ok = (status = 200, headers: Record<string, string> = {}) =>
  ({
    status,
    ok: status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  }) as unknown as Response;

test('Wikimedia hosts', () => {
  expect(isWikimedia('https://en.wikipedia.org/w/api.php?x')).toBe(true);
  expect(isWikimedia('https://commons.wikimedia.org/x')).toBe(true);
  expect(isWikimedia('https://api.duckduckgo.com/?q=x')).toBe(false);
  expect(isWikimedia('https://notwikipedia.org.evil.com/')).toBe(false);
  expect(isWikimedia('not a url')).toBe(false);
});

test('the window allows the limit per minute, then says how long to wait', () => {
  const c = fakeClock();
  const w = new RateWindow(3, 60_000, c.now);
  for (let i = 0; i < 3; i++) {
    expect(w.waitMs()).toBe(0);
    w.take();
    c.sleep(1000);
  }
  expect(w.left()).toBe(0);
  expect(w.waitMs()).toBe(57_000); // the first request ages out 60 s after it was made
  c.sleep(57_000);
  expect(w.left()).toBe(1);
});

test('Wikimedia limit stays under the 10 a minute allowed without contact details', () => {
  expect(WIKIMEDIA_PER_MIN).toBeLessThan(10);
});

test('Retry-After: seconds or a date', () => {
  expect(retryAfterMs('5')).toBe(5000);
  expect(
    retryAfterMs('Thu, 26 Nov 2026 10:00:10 GMT', Date.parse('Thu, 26 Nov 2026 10:00:00 GMT')),
  ).toBe(10_000);
  expect(retryAfterMs(null)).toBeNull();
  expect(retryAfterMs('soon')).toBeNull();
});

describe('politeFetch', () => {
  const W = 'https://en.wikipedia.org/w/api.php?q=x';
  test('waits for a Wikimedia slot when it fits the deadline, else gives up without sending', async () => {
    const c = fakeClock();
    const win = new RateWindow(2, 60_000, c.now);
    const f = jest.fn(async () => ok());
    const opts = { clock: c.now, sleep: c.sleep, window: win };
    await politeFetch(f as unknown as typeof fetch, W, {}, { ...opts, deadline: c.now() + 5000 });
    await politeFetch(f as unknown as typeof fetch, W, {}, { ...opts, deadline: c.now() + 5000 });
    // Third within the minute: 60 s to wait, more than the 5 s allowed → null, nothing sent.
    expect(
      await politeFetch(f as unknown as typeof fetch, W, {}, { ...opts, deadline: c.now() + 5000 }),
    ).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
    // With time to spare it waits, then sends.
    const r = await politeFetch(
      f as unknown as typeof fetch,
      W,
      {},
      {
        ...opts,
        deadline: c.now() + 120_000,
      },
    );
    expect(r?.status).toBe(200);
    expect(c.sleep).toHaveBeenCalledWith(60_000);
    expect(f).toHaveBeenCalledTimes(3);
  });

  test('other sites are not limited', async () => {
    const c = fakeClock();
    const win = new RateWindow(1, 60_000, c.now);
    const f = jest.fn(async () => ok());
    for (let i = 0; i < 5; i++)
      await politeFetch(
        f as unknown as typeof fetch,
        'https://example.org/',
        {},
        {
          clock: c.now,
          sleep: c.sleep,
          window: win,
          deadline: c.now() + 1000,
        },
      );
    expect(f).toHaveBeenCalledTimes(5);
    expect(win.left()).toBe(1);
  });

  test('429 with Retry-After: one wait and one retry', async () => {
    const c = fakeClock();
    const win = new RateWindow(9, 60_000, c.now);
    const f = jest
      .fn()
      .mockResolvedValueOnce(ok(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(ok(429, { 'retry-after': '2' }));
    const r = await politeFetch(
      f as unknown as typeof fetch,
      W,
      {},
      {
        clock: c.now,
        sleep: c.sleep,
        window: win,
        deadline: c.now() + 10_000,
      },
    );
    expect(c.sleep).toHaveBeenCalledWith(2000);
    expect(f).toHaveBeenCalledTimes(2); // no second retry
    expect(r?.status).toBe(429);
    expect(win.left()).toBe(7); // both tries counted
  });

  test('a wait longer than the deadline is not taken', async () => {
    const c = fakeClock();
    const f = jest.fn(async () => ok(429, { 'retry-after': '30' }));
    const r = await politeFetch(
      f as unknown as typeof fetch,
      'https://example.org/',
      {},
      {
        clock: c.now,
        sleep: c.sleep,
        deadline: c.now() + 4000,
      },
    );
    expect(r?.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(1);
    expect(c.sleep).not.toHaveBeenCalled();
  });

  test('503 without Retry-After is not retried; 429 without it waits 2 s', async () => {
    const c = fakeClock();
    const f = jest.fn().mockResolvedValueOnce(ok(503)).mockResolvedValue(ok());
    await politeFetch(
      f as unknown as typeof fetch,
      'https://example.org/',
      {},
      {
        clock: c.now,
        sleep: c.sleep,
        deadline: c.now() + 9000,
      },
    );
    expect(f).toHaveBeenCalledTimes(1);
    const g = jest.fn().mockResolvedValueOnce(ok(429)).mockResolvedValue(ok());
    const r = await politeFetch(
      g as unknown as typeof fetch,
      'https://example.org/',
      {},
      {
        clock: c.now,
        sleep: c.sleep,
        deadline: c.now() + 9000,
      },
    );
    expect(c.sleep).toHaveBeenCalledWith(2000);
    expect(r?.status).toBe(200);
  });
});

describe('research fits the Wikimedia budget', () => {
  test('searches are trimmed to leave room for reading articles', () => {
    expect(searchesWithin(4, 9)).toBe(3); // 3 searches × 2 + 3 articles = 9
    expect(searchesWithin(4, 20)).toBe(4);
    expect(searchesWithin(4, 2)).toBe(1); // always at least one (other sources still answer)
  });
  test('reads take Wikipedia pages only while the budget lasts', () => {
    const order = ['w1', 'w2', 'x1', 'w3', 'x2', 'w4', 'x3', 'x4'];
    const isWiki = (s: string) => s.startsWith('w');
    expect(chooseReads(order, 6, 2, isWiki)).toEqual(['w1', 'w2', 'x1', 'x2', 'x3', 'x4']);
    expect(chooseReads(order, 6, 9, isWiki)).toEqual(['w1', 'w2', 'x1', 'w3', 'x2', 'w4']);
    expect(chooseReads(order, 6, 0, isWiki)).toEqual(['x1', 'x2', 'x3', 'x4']);
  });
});

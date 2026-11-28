import {
  embedFitting,
  mentionedName,
  asksAboutSomethingSeen,
  asksAboutWhatIsInView,
  embedderChanged,
  imageHits,
  ftsQuery,
  fuseRankings,
  timeWindow,
} from '../src/memory/search-logic';

test('rank fusion favours ids found by both searches', () => {
  expect(
    fuseRankings([
      [1, 2, 3],
      [3, 4],
    ])[0],
  ).toBe(3);
});

test('fts query drops filler words and quotes the rest', () => {
  expect(ftsQuery('What did Sam say about the train?')).toBe(
    '"sam"* OR "say"* OR "about"* OR "train"*',
  );
  expect(ftsQuery('what is it')).toBeNull();
});

test('time windows', () => {
  const now = new Date(2026, 10, 23, 15, 0); // Mon 23 Nov 2026, 15:00
  const morning = timeWindow('what did that sign say this morning?', now)!;
  expect(new Date(morning.from).getHours()).toBe(0);
  expect(new Date(morning.to).getHours()).toBe(12);
  const y = timeWindow('who did I talk to yesterday', now)!;
  expect(new Date(y.from).getDate()).toBe(22);
  const lw = timeWindow('last week', now)!;
  expect(new Date(lw.from).getDate()).toBe(16);
  expect(timeWindow('what is the capital of France', now)).toBeNull();
});

test('detects questions about things seen', () => {
  expect(asksAboutSomethingSeen('What did that sign say?')).toBe(true);
  expect(asksAboutSomethingSeen('Who is coming on Friday?')).toBe(false);
});

test('only questions about the view take a photo', () => {
  expect(asksAboutWhatIsInView('What am I looking at?')).toBe(true);
  expect(asksAboutWhatIsInView('How much is this?')).toBe(true);
  expect(asksAboutWhatIsInView("What's that building?")).toBe(true);
  expect(asksAboutWhatIsInView('Can you read this label')).toBe(true);
  expect(asksAboutWhatIsInView('What is my locker code?')).toBe(false);
  expect(asksAboutWhatIsInView('When does my train leave?')).toBe(false);
  expect(asksAboutWhatIsInView('What did that sign say?')).toBe(false);
});

describe('photo vectors', () => {
  test('re-embeds when the embedder file changes, including upgrades with no record', () => {
    expect(embedderChanged(null, 'b.litertlm')).toBe(true);
    expect(embedderChanged('a.litertlm', 'b.litertlm')).toBe(true);
    expect(embedderChanged('b.litertlm', 'b.litertlm')).toBe(false);
  });

  test('only the top few photo matches join the ranking unless a time window filters them', () => {
    expect(imageHits(false)).toBe(3);
    expect(imageHits(true)).toBe(200);
  });

  test('a photo matched only by its image still reaches the fused ranking', () => {
    const text = [1, 2, 3];
    const photos = [9];
    const words = [2];
    const fused = fuseRankings([text, photos, words]);
    expect(fused[0]).toBe(2);
    expect(fused).toContain(9);
  });
});

describe('mentionedName', () => {
  it('finds a place by its city name', () => {
    expect(mentionedName('What did I say in Leeds yesterday?', ['Leeds, GB', 'York, GB'])).toBe(
      'Leeds, GB',
    );
  });
  it('finds a person and prefers the longest name', () => {
    expect(mentionedName('what did sam smith say about the car', ['Sam', 'Sam Smith'])).toBe(
      'Sam Smith',
    );
  });
  it('ignores partial words', () => {
    expect(mentionedName('what about samples', ['Sam'])).toBeNull();
  });
});

test('"N minutes ago" windows grow with N and handle "a few"', () => {
  const now = new Date(2026, 10, 25, 14, 3, 45);
  const t = now.getTime();
  const five = timeWindow('what did I see 5 minutes ago?', now)!;
  expect(five.from).toBe(t - 7.5 * 60_000);
  expect(five.to).toBe(t - 2.5 * 60_000);
  const one = timeWindow('what did I see a minute ago?', now)!;
  expect(one).toEqual({ from: t - 2 * 60_000, to: t });
  const few = timeWindow('what did I see a few minutes ago', now)!;
  expect(few.from).toBe(t - 4.5 * 60_000);
  expect(timeWindow('a couple of hours ago', now)!.to).toBe(t - 3600_000);
});

describe('embedFitting: a memory too long for the embedder', () => {
  // Fake embedder: 1 token per character, at most 50; the vector is the text's length.
  const tooLong = (n: number) =>
    new Error(
      `ComputeEmbedding failed: INVALID_ARGUMENT: Input sequence length (${n}) exceeds maximum supported signature length (50).`,
    );
  const embed = jest.fn(async (texts: string[]) => {
    const long = texts.find((t) => t.length > 50);
    if (long) throw tooLong(long.length);
    return texts.map((t) => [t.length]);
  });
  beforeEach(() => embed.mockClear());

  it('no longer fails the whole batch: the long one is shortened, the others are as they were', async () => {
    const v = await embedFitting(embed, ['short', 'x'.repeat(200), 'also short']);
    expect(v[0]).toEqual([5]);
    expect(v[1][0]).toBeLessThanOrEqual(50);
    expect(v[1][0]).toBeGreaterThan(30);
    expect(v[2]).toEqual([10]);
  });
  it('a batch that fits is one call', async () => {
    await embedFitting(embed, ['a', 'b']);
    expect(embed).toHaveBeenCalledTimes(1);
  });
  it('other errors still fail', async () => {
    const broken = async () => {
      throw new Error('model not loaded');
    };
    await expect(embedFitting(broken, ['a'])).rejects.toThrow('model not loaded');
  });
});

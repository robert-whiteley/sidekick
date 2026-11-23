import {
  asksAboutSomethingSeen,
  asksAboutWhatIsInView,
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

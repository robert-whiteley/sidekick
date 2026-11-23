import { LiveTranscript, MAX_LIVE_LINES } from '../src/engine/live-transcript';
import { listenPlan } from '../src/engine/listen-mode';
import { wakeKeywordLines, wakeVariants } from '../src/engine/wake-word';

const line = (at: number, extra = {}) => ({
  at,
  text: `t${at}`,
  speakerId: 1,
  isOwner: false,
  saved: true,
  ...extra,
});

test('lines stay in time order and are capped', () => {
  const t = new LiveTranscript();
  t.put(line(2));
  t.put(line(1));
  expect(t.all.map((l) => l.at)).toEqual([1, 2]);
  for (let i = 3; i < MAX_LIVE_LINES + 10; i++) t.put(line(i));
  expect(t.all).toHaveLength(MAX_LIVE_LINES);
  expect(t.all[t.all.length - 1].at).toBe(MAX_LIVE_LINES + 9);
});

test('a journal line replaces an event-only line, never the reverse', () => {
  const t = new LiveTranscript();
  const seen: number[] = [];
  t.subscribe((l) => seen.push(l.length));
  t.put(line(5, { speakerId: null, saved: false }));
  t.put(line(5, { speakerId: 3 }));
  expect(t.all[0].speakerId).toBe(3);
  t.put(line(5, { speakerId: null, saved: false }));
  expect(t.all[0].speakerId).toBe(3);
  expect(t.has(5)).toBe(true);
  t.clear();
  expect(t.all).toEqual([]);
  expect(seen).toEqual([1, 1, 0]);
});

test('instructions only: nothing ambient is transcribed or kept', () => {
  expect(listenPlan({ recordConversations: true, instructionsOnly: true })).toEqual({
    recordAmbient: false,
    commandsOnly: true,
  });
  expect(listenPlan({ recordConversations: true, instructionsOnly: false })).toEqual({
    recordAmbient: true,
    commandsOnly: false,
  });
  expect(listenPlan({ recordConversations: false, instructionsOnly: false }).recordAmbient).toBe(
    false,
  );
});

test('the wake word works with or without its greeting', () => {
  expect(wakeVariants('Hey Sidekick')).toEqual(['Hey Sidekick', 'Sidekick']);
  expect(wakeVariants('ok  jarvis')).toEqual(['ok jarvis', 'jarvis']);
  expect(wakeVariants('Sidekick')).toEqual(['Sidekick']);
  const vocab = new Map<string, number>([
    ['▁HE', -5],
    ['Y', -3],
    ['▁', -2],
    ['SIDE', -6],
    ['K', -3],
    ['IC', -4],
  ]);
  // Same tokens as the gigaspeech model's own segmentation (checked against its bpe.model).
  expect(wakeKeywordLines('Hey Sidekick', vocab)).toBe(
    '▁HE Y ▁ SIDE K IC K :2.0 #0.25 @HEY_SIDEKICK\n▁ SIDE K IC K :2.0 #0.25 @SIDEKICK',
  );
});

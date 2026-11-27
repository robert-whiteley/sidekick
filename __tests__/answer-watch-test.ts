/**
 * No answer sits on one line with no sign of life (answer-watch.ts): a slow step counts its
 * seconds, and nothing new for STALL_MS (no step, no words) means the chat stops waiting.
 */
import {
  AnswerWatch,
  progressLine,
  SHOW_SECONDS_AFTER_MS,
  STALL_MS,
  STALLED_PHOTO_TEXT,
} from '@/features/ask/answer-watch';

test('a slow step shows its seconds; a quick one stays plain', () => {
  expect(progressLine('Looking at the picture…', 2_000)).toBe('Looking at the picture…');
  expect(progressLine('Looking at the picture…', 23_400)).toBe('Looking at the picture… 23 s');
  expect(progressLine('', 60_000)).toBe('');
});

test('each new step starts its own count', () => {
  const w = new AnswerWatch(0);
  w.step('Loading the model…', 0);
  expect(w.line(30_000)).toBe('Loading the model… 30 s');
  w.step('Looking at the picture…', 30_000);
  expect(w.line(30_000 + SHOW_SECONDS_AFTER_MS - 1)).toBe('Looking at the picture…');
  expect(w.line(42_000)).toBe('Looking at the picture… 12 s');
});

test('stalled only after STALL_MS with no step and no words', () => {
  const w = new AnswerWatch(0);
  w.step('Looking at the picture…', 0);
  expect(w.stalled(STALL_MS - 1)).toBe(false);
  expect(w.stalled(STALL_MS)).toBe(true);
  // Words (or a new step) keep it alive.
  w.alive(STALL_MS);
  expect(w.stalled(STALL_MS + 1_000)).toBe(false);
  w.step('Writing…', 2 * STALL_MS - 1);
  expect(w.stalled(2 * STALL_MS)).toBe(false);
  // A finished answer never stalls.
  w.finish();
  expect(w.stalled(10 * STALL_MS)).toBe(false);
});

test('the photo timeout says what happened in plain words', () => {
  expect(STALL_MS).toBeLessThanOrEqual(120_000);
  expect(STALLED_PHOTO_TEXT).toMatch(/took too long/);
  expect(STALLED_PHOTO_TEXT).toMatch(/try again/i);
});

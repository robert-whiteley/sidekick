import type { Moment } from '@/memory/store';
import {
  clipAround,
  FACT_CHARS,
  FACT_LIMIT,
  MOMENT_CHARS,
  clip,
  memoryContext,
  pickFacts,
} from '@/engine/prompt-budget';

const moment = (id: number, text: string): Moment => ({
  id,
  kind: 'speech',
  at: Date.UTC(2026, 10, 23, 9, 0),
  text,
  speakerId: null,
  speakerName: 'Anna',
  isOwner: false,
  photoPath: null,
  place: null,
});

describe('clip', () => {
  it('keeps short text, collapsing whitespace', () => {
    expect(clip('  hello \n  there ', 50)).toBe('hello there');
  });
  it('cuts long text at a word boundary within the limit', () => {
    const out = clip('the quick brown fox jumps over the lazy dog', 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toBe('the quick brown fox…');
  });
  it('cuts mid-word when there is no usable space', () => {
    expect(clip('a'.repeat(50), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

describe('pickFacts', () => {
  const facts = ['Wifi password is otter42', 'Dentist is Dr Patel', 'Car is parked on level 3'];
  it('puts facts that share words with the question first', () => {
    expect(pickFacts(facts, 'Where is the car parked?', 1)).toEqual(['Car is parked on level 3']);
  });
  it('keeps the given (newest-first) order when nothing matches', () => {
    expect(pickFacts(facts, 'Hello there', 2)).toEqual(facts.slice(0, 2));
  });
  it('caps at the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => `fact ${i}`);
    expect(pickFacts(many, 'anything')).toHaveLength(FACT_LIMIT);
  });
});

describe('memoryContext', () => {
  it('is empty with nothing to say', () => {
    expect(memoryContext([], [])).toBe('');
  });
  it('includes at most the requested moments and clips each', () => {
    const long = 'word '.repeat(200);
    const ms = Array.from({ length: 8 }, (_, i) => moment(i, long));
    const ctx = memoryContext(ms, ['x '.repeat(200)], 3);
    const lines = ctx.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(4);
    expect(lines[0].length).toBeLessThanOrEqual('- Saved fact: '.length + FACT_CHARS);
    for (const l of lines.slice(1)) {
      expect(l).toContain('(Anna)');
      expect(l.slice(l.indexOf('(Anna) ') + 7).length).toBeLessThanOrEqual(MOMENT_CHARS);
    }
  });
  it('stays short for a typical question: far below the old 6 x 300 char budget', () => {
    const ms = Array.from({ length: 6 }, (_, i) => moment(i, 'blah '.repeat(80)));
    const facts = Array.from({ length: 10 }, (_, i) => `saved fact number ${i} `.repeat(10));
    expect(memoryContext(ms, facts).length).toBeLessThan(1800);
  });
});

describe('clipAround', () => {
  it('keeps the sentences that match the question', () => {
    const text =
      'The meeting started late because of traffic on the ring road. Everyone had coffee first. ' +
      'Later we agreed the budget for the garden project is four thousand pounds. Then lunch.';
    const out = clipAround(text, 'what is the garden budget', 90);
    expect(out).toContain('garden project');
    expect(out.startsWith('…')).toBe(true);
  });
  it('falls back to the opening without a question', () => {
    expect(clipAround('One two three. Four five six.', '', 12)).toBe(
      clip('One two three. Four five six.', 12),
    );
  });
});

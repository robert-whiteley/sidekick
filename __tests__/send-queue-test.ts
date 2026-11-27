import { withoutOffRecord } from '@/features/ask/chat-logic';
import {
  editQueued,
  enqueue,
  type QueuedMessage,
  takeNext,
  toFront,
  unansweredAfter,
  withoutQueued,
  withOwed,
} from '@/features/ask/send-queue';

const msg = (id: string, text = id, extra: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id,
  text,
  at: 1,
  spoken: false,
  followUp: false,
  offRecord: false,
  ...extra,
});

describe('messages sent while answering', () => {
  it('wait in the order they were sent, trimmed; empty ones are not queued', () => {
    let q = enqueue([], msg('a', ' first '));
    q = enqueue(q, msg('b', 'second'));
    q = enqueue(q, msg('c', '   '));
    expect(q.map((m) => [m.id, m.text])).toEqual([
      ['a', 'first'],
      ['b', 'second'],
    ]);
  });

  it('are answered one at a time, first in first out', () => {
    const q = [msg('a'), msg('b'), msg('c')];
    const one = takeNext(q);
    expect(one.next?.id).toBe('a');
    expect(one.rest.map((m) => m.id)).toEqual(['b', 'c']);
    expect(takeNext([])).toEqual({ next: null, rest: [] });
  });

  it('one being edited does not start: the next one goes ahead of it', () => {
    const q = [msg('a'), msg('b')];
    const one = takeNext(q, 'a');
    expect(one.next?.id).toBe('b');
    expect(one.rest.map((m) => m.id)).toEqual(['a']);
    expect(takeNext([msg('a')], 'a')).toEqual({ next: null, rest: [msg('a')] });
  });

  it('can be edited in place or removed until they start', () => {
    const q = [msg('a'), msg('b'), msg('c')];
    expect(editQueued(q, 'b', ' new ').map((m) => m.text)).toEqual(['a', 'new', 'c']);
    expect(editQueued(q, 'b', '  ').map((m) => m.id)).toEqual(['a', 'c']);
    expect(withoutQueued(q, 'a').map((m) => m.id)).toEqual(['b', 'c']);
    expect(editQueued(q, 'gone', 'x')).toEqual(q);
  });

  it('Send now puts one first, the rest keep their order', () => {
    const q = [msg('a'), msg('b'), msg('c')];
    expect(toFront(q, 'c').map((m) => m.id)).toEqual(['c', 'a', 'b']);
    expect(toFront(q, 'gone')).toBe(q);
  });

  it('Off the record ones go when the mode is left', () => {
    const q = [msg('a'), msg('b', 'b', { offRecord: true })];
    expect(withoutOffRecord(q).map((m) => m.id)).toEqual(['a']);
  });
});

describe('a question stopped by Send now', () => {
  it('with no words of its answer yet is answered together with the new message', () => {
    const owed = unansweredAfter([], { question: 'weather?', text: ' ', stopped: 'now' });
    expect(owed).toEqual(['weather?']);
    expect(withOwed(owed, 'and tomorrow?')).toBe('weather?\n\nand tomorrow?');
  });

  it('keeps what was written: nothing is owed, the model has its part-answer in the chat', () => {
    expect(unansweredAfter([], { question: 'q', text: 'It is sun', stopped: 'now' })).toEqual([]);
  });

  it('plain Stop means not that one: nothing is carried', () => {
    expect(unansweredAfter([], { question: 'q', text: '', stopped: 'stop' })).toEqual([]);
  });

  it('two Send nows in a row before any words carry both; an answer clears them', () => {
    const one = unansweredAfter([], { question: 'a', text: '', stopped: 'now' });
    const two = unansweredAfter(one, { question: 'b', text: '', stopped: 'now' });
    expect(two).toEqual(['a', 'b']);
    expect(unansweredAfter(two, { question: 'c', text: 'done', stopped: null })).toEqual([]);
    expect(withOwed([], 'just this')).toBe('just this');
  });
});

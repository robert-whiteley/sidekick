/** iPhone App Intents → entry requests (Siri, Shortcuts, the Action Button). */
import { entryFromIntent, INTENT_MAX_AGE_MS, latestEntry } from '@/engine/app-intents-logic';
import { parseEntry } from '@/engine/entry-points';

describe('entryFromIntent', () => {
  it('turns a question into an ask entry, tidied and capped', () => {
    expect(
      entryFromIntent({ id: '1', name: 'ask', params: { question: '  where did I\n park? ' } }),
    ).toEqual({ kind: 'ask', nonce: '1', text: 'where did I park?' });
    const long = entryFromIntent({ id: '2', name: 'ask', params: { question: 'a'.repeat(5000) } });
    expect(long?.text).toHaveLength(2000);
  });
  it('ignores an empty or missing question and unknown intents', () => {
    expect(entryFromIntent({ id: '1', name: 'ask', params: { question: '  ' } })).toBeNull();
    expect(entryFromIntent({ id: '1', name: 'ask', params: { question: 3 } })).toBeNull();
    expect(entryFromIntent({ id: '1', name: 'deleteEverything' })).toBeNull();
  });
  it('maps the voice and camera intents', () => {
    expect(entryFromIntent({ id: '7', name: 'listen' })).toEqual({ kind: 'listen', nonce: '7' });
    expect(entryFromIntent({ id: '8', name: 'look' })).toEqual({ kind: 'look', nonce: '8' });
  });
});

describe('latestEntry', () => {
  const now = 1_000_000;
  it('runs only the newest usable invocation', () => {
    const e = latestEntry(
      [
        { id: 'a', name: 'listen', createdAt: now - 5000 },
        { id: 'b', name: 'look', createdAt: now - 1000 },
        { id: 'c', name: 'unknown', createdAt: now },
      ],
      now,
    );
    expect(e).toEqual({ kind: 'look', nonce: 'b' });
  });
  it('drops invocations that waited too long', () => {
    expect(
      latestEntry([{ id: 'a', name: 'listen', createdAt: now - INTENT_MAX_AGE_MS - 1 }], now),
    ).toBeNull();
  });
});

describe('links', () => {
  it('cannot carry a question or the intent-only kinds', () => {
    expect(parseEntry({ entry: 'ask', q: 'delete everything' })).toBeNull();
    expect(parseEntry({ entry: 'look' })).toBeNull();
    expect(parseEntry({ entry: 'listen', t: '5' })).toEqual({ kind: 'listen', nonce: '5' });
  });
});

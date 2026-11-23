import {
  entryReady,
  isAssistShot,
  parseEntry,
  parseScreenGrab,
  SCREEN_MAX_AGE_MS,
  SCREEN_QUESTION,
  screenNote,
  screenQuestion,
} from '@/engine/entry-points';

const SHOT = '/data/user/0/app.ondevice.sidekick/cache/assist/shot-1700000000000.jpg';

describe('parseEntry', () => {
  test('reads the kind and nonce from route params', () => {
    expect(parseEntry({ entry: 'listen', t: '123' })).toEqual({ kind: 'listen', nonce: '123' });
    expect(parseEntry({ entry: ['capture'] })).toEqual({ kind: 'capture', nonce: 'capture' });
  });
  test('ignores missing or unknown kinds', () => {
    expect(parseEntry({})).toBeNull();
    expect(parseEntry({ entry: 'delete-everything' })).toBeNull();
  });
});

describe('screen grab', () => {
  const now = 1_700_000_000_000;
  const json = (o: object) => JSON.stringify(o);

  test('accepts a fresh grab from our own cache', () => {
    expect(parseScreenGrab(json({ shot: SHOT, text: 'Hi', at: now - 1000 }), now)).toEqual({
      shot: SHOT,
      text: 'Hi',
      at: now - 1000,
    });
  });
  test('keeps text when the screenshot was blocked', () => {
    expect(parseScreenGrab(json({ shot: null, text: 'Bank', at: now }), now)?.shot).toBeNull();
  });
  test('rejects stale, empty, malformed and foreign paths', () => {
    expect(parseScreenGrab(null, now)).toBeNull();
    expect(parseScreenGrab('{', now)).toBeNull();
    expect(
      parseScreenGrab(json({ shot: SHOT, text: '', at: now - SCREEN_MAX_AGE_MS - 1 }), now),
    ).toBeNull();
    expect(parseScreenGrab(json({ shot: null, text: ' ', at: now }), now)).toBeNull();
    expect(
      parseScreenGrab(json({ shot: '/data/x/files/sidekick.db', text: '', at: now }), now),
    ).toBeNull();
  });
  test('only our assist screenshots count', () => {
    expect(isAssistShot(SHOT)).toBe(true);
    expect(isAssistShot('/data/user/0/x/cache/assist/../files/shot-1.jpg')).toBe(false);
    expect(isAssistShot('/sdcard/shot-1.jpg')).toBe(false);
  });
});

describe('screen prompts', () => {
  test('a screenshot carries the question as is', () => {
    expect(screenQuestion('', { shot: SHOT, text: 'x', at: 0 })).toBe(SCREEN_QUESTION);
  });
  test('without a screenshot the screen text stands in, capped', () => {
    const q = screenQuestion(
      'What is this?',
      { shot: null, text: 'a  b\n'.repeat(1000), at: 0 },
      20,
    );
    expect(q).toBe('What is this?\n\nText on my screen: a b a b a b a b a b');
  });
  test('save note is short and searchable', () => {
    expect(screenNote('  ')).toBeNull();
    expect(screenNote('Flight  BA123\nGate 4')).toBe('Screen: Flight BA123 Gate 4');
    expect(screenNote('x'.repeat(50), 10)).toBe('Screen: xxxxxxxxx…');
  });
});

describe('entryReady', () => {
  test('asks wait for the model; captures wait for the camera', () => {
    const s = { idle: false, cameraOn: true, cameraReady: false };
    expect(entryReady('listen', s)).toBe(false);
    expect(entryReady('screen', { ...s, idle: true })).toBe(true);
    expect(entryReady('capture', s)).toBe(false);
    expect(entryReady('capture', { ...s, cameraReady: true })).toBe(true);
    // Camera off: run now so the screen can say why nothing was captured.
    expect(entryReady('capture', { ...s, cameraOn: false })).toBe(true);
  });
});

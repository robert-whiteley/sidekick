import {
  alertText,
  listWatches,
  looksLikeName,
  matchWatches,
  newWatch,
  noteAlert,
  scoreFrame,
  WARMUP,
} from '../src/engine/focus-logic';

/** Unit vectors with a chosen cosine to [1, 0, 0, …]. */
function vec(sim: number, twist = 1): number[] {
  const v = new Array(8).fill(0);
  v[0] = sim;
  v[twist] = Math.sqrt(1 - sim * sim);
  return v;
}
const target = [1, 0, 0, 0, 0, 0, 0, 0];

function warmed(every = false) {
  const w = newWatch('red bus', every, 0);
  w.vector = target;
  // A street with no bus: similarities around 0.08–0.12.
  for (let i = 0; i < WARMUP + 5; i++)
    scoreFrame(w, vec(0.08 + (i % 5) * 0.01, 1 + (i % 6)), i * 2000);
  return w;
}

describe('camera watches', () => {
  it('stays quiet on ordinary frames and fires on one that stands out', () => {
    const w = warmed();
    expect(scoreFrame(w, vec(0.11, 2), 100_000)).toBe('none');
    expect(scoreFrame(w, vec(0.3, 3), 102_000)).toBe('strong');
  });
  it('needs a strong match before it has seen enough frames', () => {
    const w = newWatch('bus', false, 0);
    w.vector = target;
    expect(scoreFrame(w, vec(0.2, 2), 1000)).toBe('none');
    expect(scoreFrame(w, vec(0.3, 2), 3000)).not.toBe('none');
  });
  it('one alert per sighting: not within 8 s, not the same scene', () => {
    const w = warmed(true);
    const hit = vec(0.3, 3);
    expect(scoreFrame(w, hit, 100_000)).toBe('strong');
    expect(noteAlert(w, hit, 100_000)).toBe(true);
    expect(scoreFrame(w, vec(0.3, 4), 104_000)).toBe('none'); // within 8 s
    expect(scoreFrame(w, hit, 120_000)).toBe('none'); // same scene
    expect(scoreFrame(w, vec(0.3, 5), 130_000)).toBe('strong'); // a new scene
    expect(scoreFrame(w, hit, 100_000 + 11 * 60_000)).toBe('strong'); // same scene, much later
  });
  it('a one-off watch ends at its first sighting; expired watches never fire', () => {
    const w = warmed(false);
    expect(noteAlert(w, vec(0.3), 1)).toBe(false);
    const old = warmed();
    expect(scoreFrame(old, vec(0.4, 3), old.expiresAt + 1)).toBe('none');
  });
  it('texts', () => {
    expect(alertText('a parking space', true)).toBe('I can see a parking space now.');
    expect(alertText('bus', false)).toBe('I think I can see bus.');
    const a = newWatch('red bus', false, 0, 'a');
    const b = newWatch('parking space', false, 0, 'b');
    expect(listWatches([])).toMatch(/not watching/);
    expect(listWatches([a, b])).toBe("I'm watching for red bus and parking space.");
    expect(matchWatches([a, b], 'the bus').map((w) => w.id)).toEqual(['a']);
    expect(matchWatches([a, b], null)).toHaveLength(2);
    expect(looksLikeName('Sam')).toBe(true);
    expect(looksLikeName('a red car')).toBe(false);
    expect(looksLikeName('Bus')).toBe(false);
  });
});

import { callIfExists, speedLine, wavSeconds } from '../src/engine/bench-logic';

function wav(seconds: number, rate = 16000): string {
  const data = Math.round(seconds * rate) * 2;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  const str = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}

test('wav length comes from the header', () => {
  expect(wavSeconds(wav(2.5))).toBeCloseTo(2.5, 3);
  expect(wavSeconds(wav(1, 8000))).toBeCloseTo(1, 3);
  expect(wavSeconds(btoa('not a wav file at all'))).toBeNull();
});

test('speed lines are one JSON line with text cut to 80 chars', () => {
  const line = speedLine({
    test: 'stt',
    variant: 't4',
    ms: 12,
    ok: true,
    text: 'a\nb ' + 'x'.repeat(100),
  });
  expect(line.startsWith('[speed] {')).toBe(true);
  const j = JSON.parse(line.slice(8));
  expect(j.text).toHaveLength(80);
  expect(j.text.startsWith('a b ')).toBe(true);
});

test('optional native setters are called only if present', async () => {
  const calls: unknown[] = [];
  const mod = { setB: (x: number) => calls.push(x) };
  expect(await callIfExists(mod, ['setA', 'setB'], 3)).toBe('setB');
  expect(calls).toEqual([3]);
  expect(await callIfExists(mod, ['setC'], 1)).toBeNull();
});

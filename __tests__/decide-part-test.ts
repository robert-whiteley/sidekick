// The decide bench split into parts that run side by side (run=decide&part=k/n): every case
// lands in exactly one part.
import { inPart } from '@/engine/bench-part';

test('every case is in exactly one of n parts', () => {
  for (const n of [1, 2, 3, 5]) {
    for (let i = 0; i < 40; i++) {
      const parts = Array.from({ length: n }, (_, k) => inPart(i, `${k + 1}/${n}`));
      expect(parts.filter(Boolean)).toHaveLength(1);
    }
  }
});

test('no part, or a malformed one, keeps every case', () => {
  expect(inPart(7)).toBe(true);
  expect(inPart(7, 'half')).toBe(true);
  expect(inPart(7, '1/0')).toBe(true);
});

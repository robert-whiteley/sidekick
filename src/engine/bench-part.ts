/** A bench `part` "k/n": every n-th case from the k-th, so n runs side by side share one bench. */
export function inPart(i: number, part?: string): boolean {
  const m = part?.match(/^(\d+)\/(\d+)$/);
  if (!m) return true;
  const [k, n] = [Number(m[1]), Number(m[2])];
  return n < 1 || i % n === (k - 1) % n;
}

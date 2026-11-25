/** Progress lines shown while an answer is prepared (pure, so it can be tested). */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What memory search found, said as soon as it is known (before the model starts). */
export function memoryStatus(notes: number, frames: number, matches: number): string {
  if (frames) return `Looking at ${plural(frames, 'frame')} from the camera…`;
  if (matches) return `Found ${plural(matches, 'moment')}, thinking…`;
  if (notes) return `Found ${plural(notes, 'memory', 'memories')}, thinking…`;
  return 'Thinking…';
}

import { oneRunAtATime } from '../src/memory/one-run';

test('overlapping background runs never run the job twice at once', async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const job = oneRunAtATime(async () => {
    calls++;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return calls;
  });
  const results = await Promise.all([job(true), job(true), job(false), job(true)]);
  expect(maxActive).toBe(1);
  // Skippers that arrive mid-run get null; the waiter runs after the first run.
  expect(results).toEqual([1, null, 2, null]);
});

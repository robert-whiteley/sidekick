import { ForegroundGate } from '../src/engine/foreground-gate';

describe('ForegroundGate', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('lets background work through when nothing is being answered', async () => {
    const g = new ForegroundGate(1000);
    await expect(g.idle()).resolves.toBeUndefined();
    expect(g.busy).toBe(false);
  });

  it('holds background work until the answer is over', async () => {
    const g = new ForegroundGate(1000);
    g.hold();
    let ran = false;
    const p = g.idle().then(() => (ran = true));
    await Promise.resolve();
    expect(ran).toBe(false);
    g.release();
    await p;
    expect(ran).toBe(true);
    expect(g.busy).toBe(false);
  });

  it('never holds for longer than the safety timeout', async () => {
    let now = 0;
    const g = new ForegroundGate(1000, () => now);
    g.hold();
    let ran = false;
    const p = g.idle().then(() => (ran = true));
    now = 999;
    jest.advanceTimersByTime(999);
    await Promise.resolve();
    expect(ran).toBe(false);
    now = 1000;
    jest.advanceTimersByTime(1);
    await p;
    expect(ran).toBe(true);
  });

  it('a new answer restarts the hold', async () => {
    const g = new ForegroundGate(1000);
    g.hold();
    jest.advanceTimersByTime(800);
    g.hold();
    jest.advanceTimersByTime(800);
    expect(g.busy).toBe(true);
  });
});

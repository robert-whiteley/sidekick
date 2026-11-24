import { LlmQueue } from '../src/engine/llm-queue';

const deferred = () => {
  let resolve!: () => void;
  const p = new Promise<void>((r) => (resolve = r));
  return { p, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('LlmQueue', () => {
  it('runs background jobs one at a time, in order', async () => {
    const q = new LlmQueue(() => {});
    const order: string[] = [];
    const a = deferred();
    const ja = q.run(true, async () => {
      order.push('a start');
      await a.p;
      order.push('a end');
    });
    const jb = q.run(true, async () => {
      order.push('b');
    });
    await tick();
    expect(order).toEqual(['a start']);
    a.resolve();
    await Promise.all([ja, jb]);
    expect(order).toEqual(['a start', 'a end', 'b']);
  });

  it('a user job stops a running background job and goes before waiting ones', async () => {
    const running = deferred();
    const q = new LlmQueue(() => running.resolve());
    const order: string[] = [];
    const bg1 = q.run(true, async () => {
      await running.p;
      order.push('bg1');
    });
    const bg2 = q.run(true, async () => {
      order.push('bg2');
    });
    await tick();
    const user = q.run(false, async () => {
      order.push('user');
    });
    await Promise.all([bg1, bg2, user]);
    expect(order).toEqual(['bg1', 'user', 'bg2']);
  });

  it('does not stop a running user job for another user job', async () => {
    const preempt = jest.fn();
    const q = new LlmQueue(preempt);
    const first = deferred();
    const j1 = q.run(false, () => first.p);
    const j2 = q.run(false, async () => {});
    await tick();
    expect(preempt).not.toHaveBeenCalled();
    first.resolve();
    await Promise.all([j1, j2]);
    expect(q.busy).toBe(false);
  });

  it('frees the queue when a job throws', async () => {
    const q = new LlmQueue(() => {});
    await expect(q.run(true, async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(q.run(true, async () => 1)).resolves.toBe(1);
  });
  it('keeps stopping a background job until it ends (a stop sent too early is lost)', async () => {
    jest.useFakeTimers();
    try {
      const preempt = jest.fn();
      const q = new LlmQueue(preempt);
      const bg = deferred();
      const jb = q.run(true, () => bg.p);
      await Promise.resolve();
      const ju = q.run(false, async () => 'answer');
      await Promise.resolve();
      expect(preempt).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(600);
      expect(preempt).toHaveBeenCalledTimes(3);
      bg.resolve();
      await jb;
      await expect(ju).resolves.toBe('answer');
      jest.advanceTimersByTime(1000);
      expect(preempt).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});

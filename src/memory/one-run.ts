/**
 * One run of a background job at a time. A caller that may skip ([skipIfRunning]) gets null while a
 * run is going; others wait for it to finish, then start their own.
 */
export function oneRunAtATime<A extends unknown[], R>(job: (...args: A) => Promise<R>) {
  let current: Promise<R> | null = null;
  return async (skipIfRunning: boolean, ...args: A): Promise<R | null> => {
    while (current) {
      if (skipIfRunning) return null;
      await current.catch(() => undefined);
    }
    const run = job(...args);
    current = run;
    try {
      return await run;
    } finally {
      if (current === run) current = null;
    }
  };
}

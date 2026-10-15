/**
 * Runs work for one key at a time, in the order it was asked for, and work for different keys side by side. The
 * server is one process, so this is enough to keep a read-modify-write of a project from interleaving with another:
 * the Studio's autosave, an agent's tool call and a render finishing can all reach the same project at once.
 */
export function createMutex() {
  const tails = new Map<string, Promise<unknown>>();
  return async function withLock<T>(key: string, work: () => T | Promise<T>): Promise<T> {
    const before = tails.get(key) ?? Promise.resolve();
    const run = before.then(work);
    // The next caller waits for this one to settle, whether it worked or not.
    const tail = run.then(
      () => {},
      () => {},
    );
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      // Nobody queued behind: drop the key so the map does not grow with every project ever touched.
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

/** The lock every write to a project goes through, keyed by space and project. */
export const withProjectLock = createMutex();

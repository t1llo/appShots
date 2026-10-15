/** What fail() throws: a message for the person at the Terminal, which main() prints before it exits. */
export class Failure extends Error {}

/**
 * Stops the command with a message that says what to do. It throws, so that what is open is closed on the way
 * out: a browser, a raw terminal, a status bar that was set.
 * @param {string} message
 * @returns {never}
 */
export function fail(message) {
  throw new Failure(message);
}

/**
 * Runs work that may fail() and returns { value } or { problem }. For 'appshots check', which reports and goes on.
 * @template T
 * @param {() => T | Promise<T>} work
 * @returns {Promise<{ value: T, problem?: undefined } | { value?: undefined, problem: string }>}
 */
export async function attempt(work) {
  try {
    return { value: await work() };
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    return { problem: error.message };
  }
}

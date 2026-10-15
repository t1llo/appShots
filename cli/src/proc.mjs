import { spawn } from "node:child_process";

/**
 * @typedef {object} Result
 * @property {number | null} status
 * @property {string | null} signal
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} timedOut Whether it was stopped for taking longer than its timeout.
 * @property {Error} [error] Set when the program could not be started at all.
 *
 * @typedef {object} RunOptions
 * @property {number} [timeout] Milliseconds before it is stopped; 0 for no limit. Left out, the program's own default.
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [cwd]
 * @property {string} [input] What it reads on stdin.
 * @property {"inherit" | "ignore" | Array<"ignore" | "pipe" | "inherit" | number>} [stdio]
 *
 * @typedef {(command: string, args: string[], options: RunOptions & { timeout: number }) => Promise<Result>} Runner
 */

/**
 * How long each program gets before it is taken to hang. A simulator service that is stuck answers nothing at
 * all, and without a limit the command would wait for good. A build is given no limit by its caller.
 * @type {Record<string, number>}
 */
const TIMEOUTS = {
  xcrun: 60000,
  xcodebuild: 300000,
  unzip: 300000,
  git: 10000,
};

/** @param {string} command */
export const defaultTimeout = (command) => TIMEOUTS[command] ?? 30000;

/** The system the commands run on. A test stands in for a Mac by changing it. */
export const host = { platform: process.platform };

/** @type {Runner} */
function spawnRunner(command, args, { timeout, env, cwd, input, stdio }) {
  return new Promise((resolve) => {
    const out = [];
    const err = [];
    let timedOut = false;
    let settled = false;
    let timer;
    const finish = (status, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, signal, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), timedOut, ...(error ? { error } : {}) });
    };
    let child;
    try {
      child = spawn(command, args, { env, cwd, stdio: stdio ?? ["pipe", "pipe", "pipe"] });
    } catch (error) {
      return finish(null, null, error);
    }
    child.stdout?.on("data", (chunk) => out.push(chunk));
    child.stderr?.on("data", (chunk) => err.push(chunk));
    child.once("error", (error) => finish(null, null, error));
    child.once("close", (status, signal) => finish(status, signal));
    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        // One that ignores being asked is ended for good.
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      }, timeout);
    }
    if (child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });
}

let runner = spawnRunner;

/**
 * Puts another runner in place, such as a test's scripted one, and returns the one it replaces.
 * @param {Runner} next
 */
export function setRunner(next) {
  const before = runner;
  runner = next;
  return before;
}

/**
 * Runs a program and waits for it, without blocking what else is going on.
 * @param {string} command
 * @param {string[]} [args]
 * @param {RunOptions} [options]
 * @returns {Promise<Result>}
 */
export function run(command, args = [], options = {}) {
  return runner(command, args, { ...options, timeout: options.timeout ?? defaultTimeout(command) });
}

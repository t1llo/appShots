import { spawn } from "node:child_process";
import { fail } from "../../fail.mjs";

/**
 * The recorder's own way of starting programs. proc.mjs waits for a program to end and stops one that takes too
 * long with SIGTERM, which leaves a recording with no bytes in it: simctl finishes its movie only on SIGINT. A
 * recorder runs for as long as the scene does, says when it has started, and is stopped with SIGINT. Drivers go
 * through here as well, as they too run alongside the recording and have to be stopped when it ends.
 */

/** @typedef {(command: string, args: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess} Spawner */

/** @type {Spawner} */
let spawner = spawn;

/**
 * Puts another way of starting programs in place, such as a test's fake simctl, and returns the one it replaces.
 * @param {Spawner} next
 */
export function setSpawner(next) {
  const before = spawner;
  spawner = next;
  return before;
}

/**
 * @typedef {object} Exit
 * @property {number | null} status
 * @property {string | null} signal
 * @property {number} at When it ended, as Date.now() has it.
 * @property {Error} [error] Set when the program could not be started at all.
 *
 * @typedef {object} Running
 * @property {(signal: "SIGINT" | "SIGTERM" | "SIGKILL") => void} kill
 * @property {Promise<Exit>} exited
 * @property {() => boolean} alive
 * @property {() => string} said The end of what it wrote to stdout and stderr, for a message.
 * @property {(listener: (line: string) => void) => void} onLine Each line it writes, on either stream.
 * @property {import("node:stream").Writable | null} stdin
 */

/**
 * Starts a program and hands back a way to follow and stop it. It does not wait for it.
 * @param {string} command
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string, stdin?: boolean }} [options] stdin: whether something is written to it.
 * @returns {Running}
 */
export function start(command, args, { env, cwd, stdin = false } = {}) {
  /** @type {Set<(line: string) => void>} */
  const listeners = new Set();
  let tail = "";
  /** @type {Exit | null} */
  let ended = null;
  /** @type {(exit: Exit) => void} */
  let finish = () => {};
  const exited = new Promise((resolve) => (finish = (exit) => resolve((ended ??= exit))));
  let child;
  try {
    child = spawner(command, args, { env, cwd, stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"] });
  } catch (error) {
    finish({ status: null, signal: null, at: Date.now(), error: /** @type {Error} */ (error) });
    return { kill: () => {}, exited, alive: () => false, said: () => "", onLine: () => {}, stdin: null };
  }
  for (const stream of [child.stdout, child.stderr]) {
    let partial = "";
    stream?.on("data", (chunk) => {
      const text = `${partial}${chunk}`;
      tail = `${tail}${chunk}`.slice(-4000);
      const lines = text.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) for (const listener of listeners) listener(line);
    });
    stream?.on("end", () => {
      if (partial) for (const listener of listeners) listener(partial);
      partial = "";
    });
  }
  child.stdin?.on("error", () => {});
  child.once("error", (error) => finish({ status: null, signal: null, at: Date.now(), error }));
  // "close" comes once its output has been read to the end, so no line is missed.
  child.once("close", (status, signal) => finish({ status, signal, at: Date.now() }));
  return {
    kill: (signal) => {
      if (!ended) child.kill(signal);
    },
    exited,
    alive: () => !ended,
    said: () => tail.trim(),
    onLine: (listener) => listeners.add(listener),
    stdin: child.stdin ?? null,
  };
}

/**
 * Waits for a running program to end, for `ms` at most, and says whether it did.
 * @param {Running} running
 * @param {number} ms
 */
export async function ended(running, ms) {
  let timer;
  const done = await Promise.race([running.exited.then(() => true), new Promise((resolve) => (timer = setTimeout(() => resolve(false), ms)))]);
  clearTimeout(timer);
  return done;
}

/**
 * @typedef {object} Recorder
 * @property {number} started When it said it was recording, as Date.now() has it: where the recording's time starts.
 * @property {Running} running
 * @property {number} [length] Seconds it records for by itself, for one that cannot be stopped sooner.
 * @property {(options?: { grace?: number, abandon?: boolean }) => Promise<Exit & { stopped: number }>} stop Stops it
 *   with SIGINT and waits until it has written its file. `stopped` is when it was asked to, the end of the
 *   recording's time. `grace` is how long it is first given to stop by itself, as one that a Ctrl+C at the
 *   Terminal reached already does. `abandon` is for a recording that is thrown away: one that records for a
 *   given length is not waited for then.
 */

/**
 * How long a recorder is given to write its file once it is asked to stop. simctl takes under a second; a long
 * recording on a busy Mac takes longer.
 */
const FINISHING = 30000;

/**
 * Starts a recorder and waits until it says it is recording. `ready` is what it writes then; one that says
 * nothing is taken to be recording once it has run for `quiet` milliseconds without stopping. One given a
 * `length` records that many seconds and stops by itself, and stopping it means waiting for that: screencapture
 * loses its movie on any signal.
 * @param {string} name What the messages call it, as in "simctl".
 * @param {string} command
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, ready?: RegExp, quiet?: number, timeout?: number, length?: number }} options
 * @returns {Promise<Recorder>}
 */
export async function startRecorder(name, command, args, { env, ready, quiet = 0, timeout = 10000, length }) {
  const running = start(command, args, { env });
  /** @type {(value: number) => void} */
  let heard = () => {};
  const said = new Promise((resolve) => (heard = resolve));
  if (ready) running.onLine((line) => ready.test(line) && heard(Date.now()));
  const timers = [];
  const outcome = await Promise.race([
    said.then((at) => ({ at })),
    running.exited.then((exit) => ({ exit })),
    new Promise((resolve) => timers.push(setTimeout(() => resolve({ late: true }), timeout))),
    ...(quiet > 0 ? [new Promise((resolve) => timers.push(setTimeout(() => resolve({ at: Date.now() }), quiet)))] : []),
  ]);
  for (const timer of timers) clearTimeout(timer);
  if ("exit" in outcome) {
    const { exit } = outcome;
    fail(exit.error ? `Could not start ${name}: ${exit.error.message}` : `${name} stopped before it started recording.${running.said() ? `\n${running.said()}` : ""}`);
  }
  if ("late" in outcome) {
    running.kill("SIGINT");
    if (!(await ended(running, FINISHING))) running.kill("SIGKILL");
    fail(`${name} did not start recording within ${Math.round(timeout / 1000)} seconds.${running.said() ? `\n${running.said()}` : ""}`);
  }
  return {
    started: outcome.at,
    running,
    length,
    stop: async ({ grace = 0, abandon = false } = {}) => {
      if (length !== undefined && abandon) {
        running.kill("SIGINT");
        if (!(await ended(running, 5000))) running.kill("SIGKILL");
        return { ...(await running.exited), stopped: Date.now() };
      }
      if (length !== undefined) {
        // It ends when its time is up, a little after, as it writes the movie then.
        if (!(await ended(running, Math.max(0, outcome.at + length * 1000 - Date.now()) + FINISHING))) running.kill("SIGKILL");
        return { ...(await running.exited), stopped: outcome.at + length * 1000 };
      }
      const stopped = Date.now();
      // SIGINT only: anything else leaves the movie unfinished. One that hangs on to it is asked once more, and
      // only one that still does not let go is ended for good, which loses that recording either way.
      if (running.alive() && !(grace > 0 && (await ended(running, grace)))) {
        running.kill("SIGINT");
        if (!(await ended(running, FINISHING))) {
          running.kill("SIGINT");
          if (!(await ended(running, 5000))) running.kill("SIGKILL");
        }
      }
      return { ...(await running.exited), stopped };
    },
  };
}

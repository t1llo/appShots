// Runs ffmpeg and watches it. A complex filter graph can stall without ending, and then ffmpeg waits for good; so
// its progress is read as it goes, and when the time it has written stops moving for too long it is stopped, its
// half-written file removed, and the command fails with what to try.

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { Failure } from "../fail.mjs";

/** What every run gets: no reading from the terminal, no banner, the progress on stdout instead of stderr. */
export const QUIET = ["-nostdin", "-hide_banner", "-nostats", "-y", "-progress", "pipe:1"];

/** How many of ffmpeg's last lines an error carries. */
const TAIL = 20;

/**
 * Milliseconds without progress before ffmpeg is taken to have stalled: 30 seconds, or APPSHOTS_FFMPEG_STALL
 * seconds.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function stallLimit(env = process.env) {
  const seconds = Number(env.APPSHOTS_FFMPEG_STALL);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30000;
}

/**
 * A command line as a person would type it, to paste into a Terminal.
 * @param {string} command
 * @param {string[]} args
 */
export const commandLine = (command, args) => [command, ...args].map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`)).join(" ");

/**
 * Runs ffmpeg with `args` (inputs, filters, codec and the output file last) and resolves when it has finished.
 * @param {{ ffmpeg: string }} tools
 * @param {string[]} args
 * @param {object} options
 * @param {string} options.label What it makes, for the messages: "stage 1, scene \"inbox\" (iphone, de)".
 * @param {string} [options.out] The file it writes, removed when it fails or stalls.
 * @param {number} [options.stall] Milliseconds without progress before it is stopped.
 * @param {(seconds: number) => void} [options.onProgress] Seconds of output written so far.
 * @param {() => number} [options.now] The clock the stall is measured by, in milliseconds; a test's own or Date.now.
 * @returns {Promise<{ seconds: number }>}
 */
export function runFfmpeg(tools, args, { label, out, stall = stallLimit(), onProgress, now = Date.now }) {
  const argv = [...QUIET, ...args];
  return new Promise((resolve, reject) => {
    /** @type {string[]} */
    const lines = [];
    let partial = "";
    let pending = "";
    let written = -1;
    let moved = now();
    let stalled = false;
    let settled = false;
    const child = spawn(tools.ffmpeg, argv, { stdio: ["ignore", "pipe", "pipe"] });
    const keep = (/** @type {string} */ text) => {
      const parts = (partial + text).split(/\r?\n|\r/);
      partial = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) lines.push(line);
      if (lines.length > TAIL) lines.splice(0, lines.length - TAIL);
    };
    const tail = () => [...lines, ...(partial.trim() ? [partial] : [])].slice(-TAIL).join("\n");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", keep);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (/** @type {string} */ text) => {
      const parts = (pending + text).split("\n");
      pending = parts.pop() ?? "";
      for (const line of parts) {
        const match = /^out_time_us=(\d+)/.exec(line.trim());
        if (!match) continue;
        const time = Number(match[1]);
        if (time === written) continue;
        written = time;
        moved = now();
        onProgress?.(time / 1e6);
      }
    });
    const settle = (/** @type {() => void} */ done) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      done();
    };
    const remove = () => {
      if (out) rmSync(out, { force: true });
    };
    const watch = setInterval(
      () => {
        if (stalled || now() - moved < stall) return;
        stalled = true;
        child.kill("SIGTERM");
        // A stalled graph may not hear SIGTERM at all.
        setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill("SIGKILL"), 2000).unref();
      },
      Math.max(50, Math.min(1000, stall / 4)),
    );
    child.once("error", (error) =>
      settle(() => {
        remove();
        const missing = /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT";
        reject(new Failure(missing ? `ffmpeg is not at ${tools.ffmpeg}. Run 'appshots check' to see which ffmpeg appShots finds.` : `ffmpeg could not be started for ${label}: ${error.message}`));
      }),
    );
    child.once("close", (status, signal) =>
      settle(() => {
        if (stalled) {
          remove();
          return reject(
            new Failure(
              `ffmpeg stopped making progress on ${label} for ${Math.round(stall / 100) / 10} s and was stopped. Run the compose again with --jobs 1; if it stalls again, this is the command that stalled:\n${commandLine(tools.ffmpeg, argv)}\nffmpeg's last lines:\n${tail() || "(none)"}`,
            ),
          );
        }
        if (status !== 0) {
          remove();
          return reject(new Failure(`ffmpeg failed on ${label} (${signal ? `stopped by ${signal}` : `exit status ${status}`}):\n${tail() || "(it printed nothing)"}\nThe command was:\n${commandLine(tools.ffmpeg, argv)}`));
        }
        resolve({ seconds: Math.max(0, written) / 1e6 });
      }),
    );
  });
}


import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { BUILD_CACHE } from "../../config.mjs";
import { fail } from "../../fail.mjs";
import { slugify } from "../../util.mjs";
import { xcodebuild, xcodeEnv } from "../../xcode.mjs";
import { ended, start } from "./spawn.mjs";
import { touchOf } from "./touches.mjs";

/**
 * What takes the app through a scene while it is recorded. "manual" is a person at the Terminal; { wait } is an
 * app that plays a demo by itself; { uitest } runs one UI test against the simulator; { command } runs any
 * program, such as a Maestro flow. Web steps are run by the web recorder itself.
 *
 * @typedef {"manual" | { wait: number } | { uitest: string, scheme?: string } | { command: string[] } | { web: object[] }} Drive
 *
 * @typedef {object} Outcome
 * @property {string} [failed] Why the driver failed, for a message; left out when it did its part.
 * @property {import("./touches.mjs").Touch[]} touches What it printed about touches. Its log is read by the caller.
 *
 * @typedef {object} Driving
 * @property {number} started When it started, as Date.now() has it.
 * @property {Promise<Outcome>} done Settles when the driver is done by itself, or once it has been stopped.
 * @property {() => Promise<void>} stop Stops it before it is done: the recording has reached its length, or the
 *   person pressed Ctrl+C.
 *
 * @typedef {object} DriveContext
 * @property {string} scene
 * @property {string} locale
 * @property {string} display
 * @property {string} cwd The plan's folder, where a command runs.
 * @property {string} touchLog The file a driver may write its touches to.
 * @property {number} seconds How long the recording may run at most.
 * @property {{ name: string, udid: string }} [simulator] On a simulator only.
 * @property {UiTests} [tests] For a UI test: what build-for-testing made.
 */

/**
 * What a driver finds in its environment: what it drives, where to log touches, and the moment it started, so
 * a UI test can count from it.
 * @param {DriveContext} context
 * @param {number} started
 */
export function driverEnv(context, started) {
  return {
    APPSHOTS_LOCALE: context.locale,
    APPSHOTS_DISPLAY: context.display,
    APPSHOTS_SCENE: context.scene,
    ...(context.simulator ? { APPSHOTS_UDID: context.simulator.udid } : {}),
    APPSHOTS_TOUCH_LOG: context.touchLog,
    APPSHOTS_START: String(started),
  };
}

/**
 * Stops a program that drives a scene: asked first, then told, then ended. Unlike a recorder it has nothing to
 * lose by it.
 * @param {import("./spawn.mjs").Running} running
 */
async function halt(running) {
  if (!running.alive()) return;
  running.kill("SIGINT");
  if (await ended(running, 3000)) return;
  running.kill("SIGTERM");
  if (await ended(running, 2000)) return;
  running.kill("SIGKILL");
  await running.exited;
}

/**
 * Runs a program as a driver: done when it ends, a failure when it ends with anything but 0, unless it was
 * stopped on purpose.
 * @param {string} label What a failure calls it.
 * @param {string} command
 * @param {string[]} args
 * @param {{ env: NodeJS.ProcessEnv, cwd: string }} options
 * @returns {Driving}
 */
function program(label, command, args, { env, cwd }) {
  const started = Date.now();
  const running = start(command, args, { env, cwd });
  /** @type {import("./touches.mjs").Touch[]} */
  const touches = [];
  running.onLine((line) => {
    const touch = touchOf(line);
    if (touch) touches.push(touch);
  });
  let stopping = false;
  const done = running.exited.then((exit) => {
    if (exit.error) return { failed: `Could not start ${label}: ${exit.error.message}`, touches };
    if (stopping || exit.status === 0) return { touches };
    return { failed: `${label} failed${exit.status === null ? "" : ` with exit code ${exit.status}`}.${running.said() ? `\n${running.said().split("\n").slice(-20).join("\n")}` : ""}`, touches };
  });
  return {
    started,
    done,
    stop: async () => {
      stopping = true;
      await halt(running);
    },
  };
}

/**
 * Waits for Return from the person at the Terminal. The terminal stays as it is, so Ctrl+C reaches the recorder
 * and this command as a signal, as it does everywhere else.
 * @returns {Driving}
 */
function manual() {
  const started = Date.now();
  /** @type {() => void} */
  let release = () => {};
  const done = new Promise((resolve) => (release = () => resolve({ touches: [] })));
  const listener = (/** @type {Buffer} */ data) => /[\r\n]/.test(data.toString()) && finish();
  const finish = () => {
    process.stdin.off("data", listener);
    process.stdin.pause();
    release();
  };
  process.stdin.on("data", listener);
  process.stdin.resume();
  console.log("Recording. Press Return to stop.");
  return { started, done, stop: async () => finish() };
}

/**
 * Waits for a number of seconds while the app plays by itself.
 * @param {number} seconds
 * @returns {Driving}
 */
function waiting(seconds) {
  const started = Date.now();
  let timer;
  /** @type {() => void} */
  let release = () => {};
  const done = new Promise((resolve) => {
    release = () => resolve({ touches: [] });
    timer = setTimeout(release, seconds * 1000);
  });
  return {
    started,
    done,
    stop: async () => {
      clearTimeout(timer);
      release();
    },
  };
}

/**
 * Whether a scene's driver needs a person at the Terminal, and fails without one, before anything is recorded.
 * @param {Drive | undefined} drive
 * @param {string} scene
 */
export function needsPerson(drive, scene) {
  if (drive !== "manual") return;
  if (!process.stdin.isTTY) {
    fail(`The scene ${scene} is driven by hand ("drive": "manual"), which needs a person at the Terminal. Ask the user to run 'appshots video record --scene ${scene}' in their own Terminal and take the app through the scene, or give the scene a driver that runs by itself.`);
  }
}

/**
 * Starts the driver of a scene. One without a driver is recorded for its length, as the app shows itself.
 * @param {Drive | undefined} drive
 * @param {DriveContext} context
 * @returns {Driving}
 */
export function startDriver(drive, context) {
  if (drive === undefined) return waiting(context.seconds);
  if (drive === "manual") return manual();
  if ("wait" in drive) return waiting(drive.wait);
  const started = Date.now();
  const own = driverEnv(context, started);
  if ("command" in drive) {
    const [command, ...args] = drive.command;
    return program(`The driver ${command}`, command, args, { env: { ...process.env, ...own }, cwd: context.cwd });
  }
  if ("uitest" in drive) {
    if (!context.simulator || !context.tests) fail(`The scene ${context.scene} runs a UI test, which drives a simulator; record it on one.`);
    // xcodebuild hands variables named TEST_RUNNER_<name> to the test as <name>.
    const runner = Object.fromEntries(Object.entries(own).map(([key, value]) => [`TEST_RUNNER_${key}`, value]));
    return program(`The UI test ${drive.uitest}`, "xcodebuild", ["test-without-building", ...context.tests.args, `-only-testing:${drive.uitest}`], { env: { ...context.tests.env, ...own, ...runner }, cwd: context.cwd });
  }
  return fail(`The scene ${context.scene} has web steps, which only a web app's recording runs.`);
}

/**
 * @typedef {object} UiTests
 * @property {string[]} args What test-without-building takes to find what was built.
 * @property {NodeJS.ProcessEnv} env
 */

/** @type {Map<string, Promise<UiTests>>} */
const builtTests = new Map();

/**
 * Builds the app and its UI tests for a simulator once per run, so each scene's test only runs.
 * @param {string} project The workspace or project.
 * @param {string} scheme
 * @param {{ udid: string }} simulator
 * @param {boolean} fresh Whether to build apart from Xcode's own build folder.
 * @returns {Promise<UiTests>}
 */
export function buildUiTests(project, scheme, simulator, fresh) {
  const key = `${project}\n${scheme}\n${fresh}`;
  if (!builtTests.has(key)) {
    const built = (async () => {
      const name = `${slugify(path.parse(project).name)}-tests`;
      const args = [project.endsWith(".xcworkspace") ? "-workspace" : "-project", project, "-scheme", scheme, "-destination", `platform=iOS Simulator,id=${simulator.udid}`, ...(fresh ? ["-derivedDataPath", path.join(BUILD_CACHE, name)] : [])];
      mkdirSync(BUILD_CACHE, { recursive: true });
      const log = path.join(BUILD_CACHE, `${name}.log`);
      const output = openSync(log, "w");
      let result;
      try {
        console.log(`Building ${scheme} and its UI tests…`);
        result = await xcodebuild([...args, "build-for-testing"], { stdio: ["ignore", output, output], timeout: 0 });
      } finally {
        closeSync(output);
      }
      if (result.status !== 0) {
        const errors = readFileSync(log, "utf8")
          .split("\n")
          .filter((line) => line.includes("error:"));
        fail(`The build of ${scheme}'s UI tests failed:\n${[...new Set(errors)].slice(0, 20).join("\n") || "(no error lines)"}\nFull log: ${log}`);
      }
      return { args, env: { ...(await xcodeEnv()) } };
    })();
    // A failed build is not kept, so the next run tries again.
    built.catch(() => builtTests.delete(key));
    builtTests.set(key, built);
  }
  return /** @type {Promise<UiTests>} */ (builtTests.get(key));
}

/** For a test: forgets what was built, as a new run would. */
export const forgetUiTests = () => builtTests.clear();


import { readFileSync } from "node:fs";
import { attempt, fail } from "../fail.mjs";
import { pause } from "../util.mjs";
import { xcrun } from "../xcode.mjs";

/** @typedef {{ name: string, udid: string }} Booted */

// Full battery and signal, no carrier, and Wi-Fi, as Apple's own screenshots show them.
const CLEAN = ["--dataNetwork", "wifi", "--wifiMode", "active", "--wifiBars", "3", "--cellularMode", "active", "--cellularBars", "4", "--operatorName", "", "--batteryState", "charged", "--batteryLevel", "100"];
// What an older simctl takes, which knows fewer of these.
const PLAIN = ["--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--wifiBars", "3", "--cellularBars", "4"];

/**
 * The overrides `status_bar list` reports, without its heading: empty when there are none.
 * @param {string} text
 */
const overrides = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Current Status Bar Overrides:?$/.test(line) && !/^=+$/.test(line))
    .join("\n");

/**
 * Shows 9:41 on 9 January 2007, a full battery and full signal on a simulator for as long as `work` runs, then
 * takes the override away again. One that was there before is left in place, unless it is the same as this one,
 * which is what an earlier run that was stopped half way leaves behind.
 * @template T
 * @param {Booted} simulator
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withCleanStatusBar(simulator, work) {
  // The status bar goes through a part of the simulator service that can hang while screenshots still work, so
  // it gets less time than other simctl commands, and a status bar that does not answer is left as it is.
  const statusBar = async (args) => {
    const { value, problem } = await attempt(() => xcrun(["simctl", "status_bar", simulator.udid, ...args], { timeout: 20000 }));
    return value ?? { status: 1, stdout: "", stderr: problem, stuck: true };
  };
  const listed = await statusBar(["list"]);
  const before = overrides(listed.stdout);
  // simctl reads the time as a moment and shows it in this Mac's time zone, so it is given as 9:41 here.
  const time = new Date(2007, 0, 9, 9, 41).toISOString();
  let result = listed.stuck ? listed : await statusBar(["override", "--time", time, ...CLEAN]);
  if (result.status !== 0 && !result.stuck) result = await statusBar(["override", ...PLAIN]);
  if (result.status !== 0) console.error(`appshots: could not set the status bar of ${simulator.name}, so it shows as it is. ${result.stderr.trim().split("\n").pop()}`);
  const ours = result.status === 0 && (before === "" || before === overrides((await statusBar(["list"])).stdout));
  try {
    return await work();
  } finally {
    if (ours) await statusBar(["clear"]);
  }
}

/**
 * Saves what a simulator shows as a PNG.
 * @param {Booted} simulator
 * @param {string} file
 */
async function screenshot(simulator, file) {
  const result = await xcrun(["simctl", "io", simulator.udid, "screenshot", file]);
  if (result.status !== 0) fail(`Could not capture ${simulator.name}:\n${result.stderr.trim()}`);
}

/**
 * @param {Booted} simulator
 * @param {string} file
 */
export async function captureSim(simulator, file) {
  await screenshot(simulator, file);
  console.log(`Captured ${simulator.name} -> ${file}`);
}

/**
 * Captures an app that has just been started once its screen has come to rest: two frames in a row the same, the
 * first a second after the launch. A screen that keeps moving, such as one with a video, is taken as it is after
 * four seconds. `wait`, when given, is a fixed time instead.
 * @param {Booted} simulator
 * @param {string} file
 * @param {number | null} wait Seconds, or null to wait for the screen.
 */
export async function captureSettled(simulator, file, wait) {
  if (wait !== null) {
    await pause(wait * 1000);
    return captureSim(simulator, file);
  }
  const started = Date.now();
  await pause(1000);
  let last = null;
  for (let frames = 1; ; frames++) {
    await screenshot(simulator, file);
    const frame = readFileSync(file);
    // A slow simulator takes a while over each frame, so the second one is late enough by then.
    if (last?.equals(frame) || (frames >= 2 && Date.now() - started > 4000)) break;
    last = frame;
  }
  console.log(`Captured ${simulator.name} -> ${file}`);
}

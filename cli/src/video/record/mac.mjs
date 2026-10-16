import path from "node:path";
import { macWindow } from "../../capture/mac.mjs";
import { Failure, fail } from "../../fail.mjs";
import { launchPlan } from "../../plan.mjs";
import { host, run } from "../../proc.mjs";
import { pause } from "../../util.mjs";
import { startRecorder } from "./spawn.mjs";

/**
 * Recording a Mac app's window with screencapture: the window's own pixels, without its shadow and without the
 * badge macOS puts on a window that is being shared. screencapture loses its movie when it is stopped, so it
 * records for a set number of seconds and ends by itself.
 */

/** What a Mac needs before any program may record a window, as screencapture fails without saying. */
export const SCREEN_RECORDING =
  "macOS lets a program record windows only with the Screen Recording permission: System Settings, Privacy & Security, Screen & System Audio Recording, switch on the terminal app this runs in, then start that app again.";

/**
 * An AppleScript's answer, or null when it failed.
 * @param {string} script
 */
async function osascript(script) {
  const result = await run("osascript", ["-e", script], { timeout: 30000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** @param {string} text */
const quoted = (text) => `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/**
 * The size --window asks for, or null.
 * @param {string | true | undefined} value
 * @returns {[number, number] | null}
 */
export function windowSize(value) {
  if (value === undefined) return null;
  const match = typeof value === "string" ? /^(\d{3,4})x(\d{3,4})$/.exec(value) : null;
  if (!match) fail("--window needs the window's size in points, as in: --window 1440x900");
  return [Number(match[1]), Number(match[2])];
}

/**
 * Arguments that start a Mac app dark or light, whatever the Mac is set to.
 * @param {string | undefined} appearance
 */
export const appearanceArguments = (appearance) => (appearance === "dark" ? ["-AppleInterfaceStyle", "Dark"] : appearance === "light" ? ["-NSRequiresAquaSystemAppearance", "YES"] : []);

/**
 * Quits the app when it runs, and waits until it has, so that it starts again with the scene's arguments.
 * @param {string} bundleId
 * @param {string} name
 */
async function quit(bundleId, name) {
  const running = () => osascript(`application id ${quoted(bundleId)} is running`);
  if ((await running()) !== "true") return;
  await osascript(`tell application id ${quoted(bundleId)} to quit`);
  for (const deadline = Date.now() + 15000; Date.now() < deadline; await pause(250)) if ((await running()) !== "true") return;
  fail(`${name} did not quit within 15 seconds. Close what it asks about, such as unsaved changes, and record again.`);
}

/**
 * The window of the app once it shows one.
 * @param {string} name
 * @returns {Promise<{ id: number, width: number, height: number }>}
 */
async function windowOf(name) {
  for (const deadline = Date.now() + 20000; ; await pause(500)) {
    try {
      const window = await macWindow(name);
      if (window) return window;
    } catch (error) {
      if (!(error instanceof Failure) || Date.now() > deadline) throw error;
    }
  }
}

/**
 * Records the Mac display's footage from the app's window. Each scene starts the app again in the scene's
 * language with its arguments, as a scene on the simulator does.
 * @param {any} plan
 * @param {Record<string, string | true | undefined>} flags
 * @returns {Promise<import("./index.mjs").Source>}
 */
export async function macSource(plan, flags) {
  if (host.platform !== "darwin") fail("A Mac app's window is recorded on a Mac.");
  const size = windowSize(flags.window);
  let bundleId = /** @type {string | undefined} */ (plan.app?.bundleId);
  let name = typeof flags.mac === "string" ? flags.mac : null;
  if (!bundleId && !name) fail(`Name the Mac app with --mac <name>, or put its bundle id into the plan's "app".`);
  bundleId ??= (await osascript(`id of application ${quoted(/** @type {string} */ (name))}`)) ?? fail(`There is no app called "${name}" on this Mac. Name it as the Finder does, or put its bundle id into the plan's "app".`);
  if (!name) {
    const found = await run("mdfind", [`kMDItemCFBundleIdentifier == ${quoted(bundleId)}`], { timeout: 30000 });
    const app = found.stdout.split("\n").find((line) => line.endsWith(".app"));
    name = app ? path.basename(app, ".app") : fail(`Could not find the app ${bundleId} on this Mac. Name it with --mac <name>.`);
  }
  const os = (await run("sw_vers", ["-productVersion"])).stdout.trim();
  const label = /** @type {string} */ (name);
  /** @type {{ id: number, width: number, height: number } | null} */
  let window = null;
  return {
    kind: "mac",
    label,
    model: "Mac",
    os,
    extension: ".mov",
    // Like simctl it writes a frame only when something moved.
    padded: true,
    scale: (recorded) => (window ? Math.max(1, Math.round(recorded[0] / window.width)) : 2),
    around: (work) => work(),
    open: async (scene, locale) => {
      await quit(/** @type {string} */ (bundleId), label);
      const { launchArguments } = launchPlan({ lang: locale }, scene.launch?.args ?? []);
      const opened = await run("open", ["-b", /** @type {string} */ (bundleId), "--args", ...launchArguments, ...appearanceArguments(scene.launch?.appearance)], { timeout: 60000 });
      if (opened.status !== 0) fail(`Could not start ${label}:\n${opened.stderr.trim()}`);
      let shown = await windowOf(label);
      if (size && (shown.width !== size[0] || shown.height !== size[1])) {
        const resized = await osascript(`tell application "System Events" to tell (first process whose bundle identifier is ${quoted(/** @type {string} */ (bundleId))}) to set size of front window to {${size[0]}, ${size[1]}}`);
        if (resized === null) console.log(`  ! Could not make ${label}'s window ${size[0]}×${size[1]}. Resizing another app's window needs the Accessibility permission for the terminal app: System Settings, Privacy & Security, Accessibility.`);
        else shown = await windowOf(label);
      }
      window = shown;
      if (scene.launch?.url) {
        const link = await run("open", [scene.launch.url], { timeout: 30000 });
        if (link.status !== 0) fail(`Could not open ${scene.launch.url}. Does ${label} handle that address?\n${link.stderr.trim()}`);
      }
    },
    // -o leaves the shadow out, -x the sound, -l picks the window. Nothing marks the start, so it is taken to
    // record once it has run a moment.
    record: (file, { seconds }) =>
      startRecorder("screencapture", "screencapture", ["-x", "-o", "-v", `-V${Math.ceil(seconds)}`, `-l${/** @type {{ id: number }} */ (window).id}`, file], { quiet: 1000, length: Math.ceil(seconds) }),
    help: SCREEN_RECORDING,
  };
}

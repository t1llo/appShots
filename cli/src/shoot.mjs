import { hasLanguage, projectRoute, request } from "./api.mjs";
import { giveBack } from "./args.mjs";
import { capture } from "./capture.mjs";
import { shootPlan } from "./capture-plan/run.mjs";
import { connectedDevices } from "./capture/device.mjs";
import { macWindow } from "./capture/mac.mjs";
import { withCleanStatusBar } from "./capture/sim.mjs";
import { loadConfig } from "./config.mjs";
import { fail } from "./fail.mjs";
import { shotDevice, shotLanguage } from "./shot.mjs";
import { bootedSimulators } from "./sim.mjs";
import { upload } from "./upload.mjs";
import { choose, findMatch } from "./util.mjs";

const USAGE = "Usage: appshots shoot <project> <names...> [--sim <name>] [--device <name>] [--mac <app>] [--clean] [--out <dir>]";

/**
 * The keys a person presses, one at a time, from a terminal in raw mode.
 * @returns {{ next: () => Promise<string>, close: () => void }}
 */
function terminalKeys() {
  /** @type {((key: string) => void) | null} */
  let answer = null;
  const listener = (data) => answer?.(data.toString().toLowerCase()[0]);
  process.stdin.setRawMode(true);
  // A key pressed while a screenshot is on its way is not an answer to the next question, so it is dropped.
  process.stdin.on("data", listener);
  process.stdin.resume();
  return {
    next: () =>
      new Promise((resolve) => {
        answer = (key) => {
          answer = null;
          resolve(key);
        };
      }),
    close: () => {
      process.stdin.off("data", listener);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    },
  };
}

/**
 * Where the screenshots come from, settled once and up front, so a missing or unclear source is said before the
 * first screen, not after it. A word that --sim or --device took is a screen's name when no simulator or device
 * goes by it: in `shoot streaks --device home settings`, home is a screen.
 * @param {import("./args.mjs").Args} args
 * @returns {Promise<{ sim?: { name: string, udid: string }, flags: Record<string, string | true> }>}
 */
async function settleSource(args) {
  const { flags } = args;
  if (flags.mac) {
    await macWindow(flags.mac);
    return { flags: {} };
  }
  const named = (key, candidates) => {
    const word = flags[key];
    const before = args.borrowed[key];
    if (typeof word === "string" && before !== undefined && before < args.positional.length && findMatch(candidates, word).length === 0) giveBack(args, key);
  };
  if (flags.device) {
    const devices = await connectedDevices();
    named("device", devices);
    return { flags: { device: choose(devices, flags.device, "device", "--device").udid } };
  }
  const simulators = await bootedSimulators();
  named("sim", simulators);
  const sim = choose(simulators, flags.sim, "simulator", "--sim");
  return { sim, flags: { sim: sim.udid } };
}

/**
 * For a person at the Terminal: names the screens one after the other, waits for a key while they open each,
 * then captures and uploads it.
 * @param {import("./args.mjs").Args} args The project, then the names of the screens.
 * @param {{ keys?: { next: () => Promise<string>, close: () => void } }} [options] keys: a test's keys instead of the terminal's.
 */
export async function shoot(args, { keys } = {}) {
  const { flags } = args;
  // A plan, or what fastlane wrote, needs nobody at the Terminal.
  if (flags.plan !== undefined || flags.fastlane !== undefined) return shootPlan(args);
  for (const flag of ["only", "again", "dry-run"]) if (flags[flag] !== undefined) fail(`--${flag} goes with a capture plan, as in: appshots shoot --plan appshots.capture.json --${flag}`);
  if (!keys && !process.stdin.isTTY) fail("'appshots shoot' is for a person at the Terminal: it waits for a key before each screenshot. An agent takes them with 'appshots capture', or all of them at once with 'appshots shoot --plan appshots.capture.json'.");
  if (flags.web) fail("'appshots shoot' captures what a person has opened, and a web page is drawn without a window. Take each page by its address: appshots capture --web <address> --name <name> --project <project>");
  const project = args.positional[0];
  if (!project || (args.positional.length < 2 && Object.keys(args.borrowed).length === 0)) fail(USAGE);
  const config = loadConfig();
  const device = shotDevice(flags);
  const language = shotLanguage(flags);
  await hasLanguage(config, project, language);
  if (!language) await request(config, "GET", projectRoute(project));
  const source = await settleSource(args);
  const names = args.positional.slice(1);
  if (names.length === 0) fail(USAGE);

  const taken = [];
  const skipped = [];
  let at = 0;
  const loop = async () => {
    for (; at < names.length; at++) {
      process.stdout.write(`${at + 1}/${names.length} ${names[at]}: open that screen, then press Return (s skips, q stops) `);
      let key;
      // Return takes it, s skips, q, Ctrl-C and Ctrl-D stop; any other key is a slip of the finger.
      while (!["\r", "\n", "s", "q", "\u0003", "\u0004"].includes(key)) key = await input.next();
      process.stdout.write("\n");
      if (key === "s") {
        skipped.push(names[at]);
        continue;
      }
      if (key !== "\r" && key !== "\n") break;
      // The status bar is set once for all of them, around the loop.
      const shot = await capture({ ...flags, ...source.flags, name: names[at] }, { statusBar: false });
      await upload(config, project, shot.file, shot.name, device, language);
      taken.push(shot.name);
    }
  };
  const input = keys ?? terminalKeys();
  try {
    if (flags.clean && source.sim) await withCleanStatusBar(source.sim, loop);
    else await loop();
  } finally {
    input.close();
  }
  console.log(taken.length > 0 ? `Taken ${taken.length} of ${names.length} for ${project}: ${taken.join(", ")}` : `Nothing taken for ${project}.`);
  if (skipped.length > 0) console.log(`Skipped: ${skipped.join(", ")}`);
  if (at < names.length) console.log(`Stopped before: ${names.slice(at).join(", ")}`);
}

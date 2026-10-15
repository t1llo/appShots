import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fail } from "./fail.mjs";
import { defaultTimeout, host, run } from "./proc.mjs";

/**
 * @typedef {object} Xcode
 * @property {NodeJS.ProcessEnv} env What xcrun and xcodebuild run with.
 * @property {string} dir The developer folder in use, empty when there is none.
 * @property {boolean} picked Whether it was picked here because xcode-select points at the Command Line Tools.
 */

/** @type {Promise<Xcode> | undefined} */
let found;

/**
 * The Xcode the command uses, looked for once. Full Xcode is picked when xcode-select points at the Command Line
 * Tools, which lack simctl and devicectl: the one in /Applications/Xcode.app, or else the newest Xcode*.app.
 * @returns {Promise<Xcode>}
 */
export function xcode() {
  found ??= (async () => {
    if (process.env.DEVELOPER_DIR) return { env: process.env, dir: process.env.DEVELOPER_DIR, picked: false };
    const selected = (await run("xcode-select", ["-p"])).stdout?.trim() ?? "";
    if (selected.includes(".app/")) return { env: process.env, dir: selected, picked: false };
    const [best] = installedXcodes();
    if (best) return { env: { ...process.env, DEVELOPER_DIR: best }, dir: best, picked: true };
    return { env: process.env, dir: selected, picked: false };
  })();
  return found;
}

export const xcodeEnv = async () => (await xcode()).env;

/**
 * The developer folders of the copies of Xcode in /Applications and ~/Applications that can run a simulator:
 * Xcode.app first, then the newest.
 */
export function installedXcodes() {
  const apps = [];
  for (const root of ["/Applications", path.join(homedir(), "Applications")]) {
    let names = [];
    try {
      names = readdirSync(root).filter((name) => /^Xcode.*\.app$/.test(name));
    } catch {}
    for (const name of names) {
      const developer = path.join(root, name, "Contents", "Developer");
      if (!existsSync(path.join(developer, "Platforms", "iPhoneSimulator.platform"))) continue;
      let version = "";
      try {
        version = readFileSync(path.join(root, name, "Contents", "version.plist"), "utf8").match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)</)?.[1] ?? "";
      } catch {}
      apps.push({ developer, name, version });
    }
  }
  apps.sort((a, b) => (b.name === "Xcode.app") - (a.name === "Xcode.app") || b.version.localeCompare(a.version, undefined, { numeric: true }));
  return apps.map((app) => app.developer);
}

/**
 * What to say when a tool has stopped answering, by the tool.
 * @param {string[]} args
 */
function stuck(args) {
  if (args[0] === "devicectl") return "Unlock the device, or plug it in again, and try once more.";
  return "The simulator service seems stuck: run 'xcrun simctl shutdown all', or 'killall -9 com.apple.CoreSimulator.CoreSimulatorService' if that hangs too, and try again.";
}

/**
 * Runs xcrun with the right Xcode. Fails when it cannot start or stops answering; any other outcome is the
 * caller's to judge.
 * @param {string[]} args
 * @param {import("./proc.mjs").RunOptions} [options]
 */
export async function xcrun(args, options = {}) {
  if (host.platform !== "darwin") fail("This needs a Mac with Xcode. 'appshots capture --web <address>' takes a web app's pages anywhere, and 'appshots upload' takes screenshots you already have.");
  const timeout = options.timeout ?? defaultTimeout("xcrun");
  const result = await run("xcrun", args, { env: await xcodeEnv(), ...options, timeout });
  if (result.error) fail(`Could not run xcrun: ${result.error.message}`);
  if (result.timedOut) fail(`xcrun ${args.slice(0, 2).join(" ")} did not answer within ${Math.round(timeout / 1000)} seconds. ${stuck(args)}`);
  return result;
}

/**
 * @param {string[]} args
 * @param {import("./proc.mjs").RunOptions} [options]
 */
export async function xcodebuild(args, options = {}) {
  if (host.platform !== "darwin") fail("Building an app needs a Mac with Xcode.");
  const timeout = options.timeout ?? defaultTimeout("xcodebuild");
  const result = await run("xcodebuild", args, { env: await xcodeEnv(), ...options, timeout });
  if (result.error) fail(`Could not run xcodebuild: ${result.error.message}`);
  if (result.timedOut) fail(`xcodebuild did not answer within ${Math.round(timeout / 1000)} seconds. If Xcode asks to install components or to agree to its licence, open it once and do so, then try again.`);
  return result;
}

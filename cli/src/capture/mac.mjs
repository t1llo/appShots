import { existsSync, rmSync, statSync } from "node:fs";
import { fail } from "../fail.mjs";
import { host, run } from "../proc.mjs";

/**
 * The windows apps show on this Mac, the frontmost first. Only what the system tells anyone: which app a window
 * belongs to and how large it is, not its title or what is in it.
 * @returns {Promise<Array<{ id: number, app: string, width: number, height: number }>>}
 */
async function macWindows() {
  if (host.platform !== "darwin") fail("--mac captures a window of an app running on this computer, which needs a Mac.");
  // 1 | 16: the windows on screen, without the desktop's. Layer 0 is where apps keep their ordinary windows.
  const script = `ObjC.import('CoreGraphics');
const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0)));
JSON.stringify(list.filter((w) => w.kCGWindowLayer === 0 && w.kCGWindowOwnerName && w.kCGWindowBounds).map((w) => ({ id: w.kCGWindowNumber, app: w.kCGWindowOwnerName, width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height })))`;
  const result = await run("osascript", ["-l", "JavaScript", "-e", script]);
  if (result.status !== 0) fail(`Could not list the windows on this Mac:\n${(result.stderr || result.error?.message || "").trim()}`);
  // Smaller than this is a palette or a leftover, not the window to show.
  return JSON.parse(result.stdout).filter((window) => window.width >= 200 && window.height >= 150);
}

/**
 * The frontmost window of the app called `query`.
 * @param {string | true} query
 */
export async function macWindow(query) {
  const windows = await macWindows();
  const apps = [...new Set(windows.map((window) => window.app))];
  const open = apps.length > 0 ? `Apps with a window open:\n${apps.map((app) => `  ${app}`).join("\n")}` : "No app has a window open.";
  if (typeof query !== "string") fail(`--mac needs the name of the app, as in: --mac Ledger\n${open}`);
  const needle = query.toLowerCase();
  const exact = apps.filter((app) => app.toLowerCase() === needle);
  const matches = exact.length > 0 ? exact : apps.filter((app) => app.toLowerCase().includes(needle));
  if (matches.length === 0) fail(`No app called "${query}" has a window open. Start it first, and bring it out of the Dock if it is minimised.\n${open}`);
  if (matches.length > 1) fail(`"${query}" matches several apps:\n${matches.map((app) => `  ${app}`).join("\n")}`);
  return windows.find((window) => window.app === matches[0]);
}

/**
 * Saves a window as a PNG, without its shadow.
 * @param {{ id: number, app: string }} window
 * @param {string} file
 */
export async function captureMac(window, file) {
  rmSync(file, { force: true });
  // -o leaves the window's shadow out, -x the camera sound.
  const result = await run("screencapture", ["-x", "-o", "-l", String(window.id), file]);
  if (result.status !== 0 || !existsSync(file) || statSync(file).size === 0) {
    fail(`Could not capture the window of ${window.app}.${result.stderr ? `\n${result.stderr.trim()}` : ""}\nmacOS lets a program capture windows only with the Screen Recording permission: System Settings, Privacy & Security, Screen & System Audio Recording, switch on the terminal app this runs in, then start that app again.`);
  }
  console.log(`Captured ${window.app} -> ${file}`);
}

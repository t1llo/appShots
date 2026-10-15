import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectRoute, request } from "./api.mjs";
import { fail } from "./fail.mjs";
import { run } from "./proc.mjs";
import { shotLanguage } from "./shot.mjs";
import { readJson } from "./util.mjs";

/** @typedef {import("./config.mjs").Config} Config */

/** What the last download put into a folder, so that what the next one no longer has can be taken out again. */
const MANIFEST = ".appshots-files.json";

/**
 * The files below a folder, as paths relative to it.
 * @param {string} dir
 * @returns {string[]}
 */
function filesBelow(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesBelow(path.join(dir, entry.name)).map((file) => path.join(entry.name, file)) : [entry.name],
  );
}

/**
 * Unpacks a download into a folder. What the download holds replaces what is there under the same names, as
 * a whole, so a slide that is gone leaves no picture behind for 'store push' to upload. What an earlier download
 * put there and this one no longer has goes too; anything else in the folder stays.
 * @param {string} zip
 * @param {string} outDir
 * @returns {Promise<string[]>} The files unpacked, relative to the folder.
 */
export async function extractZip(zip, outDir) {
  mkdirSync(outDir, { recursive: true });
  // Inside the folder, so that what is unpacked can be moved into place rather than copied.
  const staging = mkdtempSync(path.join(outDir, ".appshots-"));
  try {
    const result = await run("unzip", ["-o", "-q", zip, "-d", staging]);
    if (result.status !== 0) fail(`Could not unpack the download: ${(result.stderr || result.error?.message || "").trim()}`);
    const files = filesBelow(staging);
    const entries = readdirSync(staging);
    const earlier = readJson(path.join(outDir, MANIFEST))?.entries;
    for (const name of entries) {
      rmSync(path.join(outDir, name), { recursive: true, force: true });
      renameSync(path.join(staging, name), path.join(outDir, name));
    }
    // Only plain names a download could have put there, whatever the list says.
    const gone = (Array.isArray(earlier) ? earlier : []).filter((name) => typeof name === "string" && !entries.includes(name) && !/[/\\]|^\.\.?$|^$/.test(name) && name !== MANIFEST);
    for (const name of gone) rmSync(path.join(outDir, name), { recursive: true, force: true });
    writeFileSync(path.join(outDir, MANIFEST), `${JSON.stringify({ entries }, null, 2)}\n`);
    return files;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Downloads a zip the server makes and unpacks it into a folder.
 * @param {Config} config
 * @param {string} route
 * @param {string} outDir
 */
async function download(config, route, outDir) {
  const response = await request(config, "GET", route);
  const dir = mkdtempSync(path.join(tmpdir(), "appshots-"));
  const zip = path.join(dir, "download.zip");
  try {
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    return await extractZip(zip, outDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Downloads the rendered set as the server zips it and unpacks it into a folder.
 * @param {Config} config
 * @param {string} project
 * @param {string} outDir
 * @param {unknown} render
 */
export const fetchExport = (config, project, outDir, render) => download(config, projectRoute(project, `/export.zip${render ? "?render=1" : ""}`), outDir);

/**
 * @param {Config} config
 * @param {string} project
 * @param {Record<string, string | true>} flags
 */
export async function pull(config, project, flags) {
  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : path.join("store-screenshots", project));
  await fetchExport(config, project, outDir, flags.render);
  console.log(`Screenshots are in ${outDir}`);
}

/** The flags of `mockups` that say how the device is drawn, and the setting each one is on the server. */
const MOCKUP_FLAGS = { frame: "frame", style: "style", color: "color", shadow: "shadow", rotate: "rotate", perspective: "perspective", "status-bar": "statusBar", time: "statusBarTime" };

/**
 * @param {Config} config
 * @param {string} project
 * @param {Record<string, string | true>} flags
 */
export async function mockups(config, project, flags) {
  /** @type {Record<string, unknown>} */
  const device = {};
  for (const [flag, field] of Object.entries(MOCKUP_FLAGS)) {
    if (flags[flag] === true) fail(`--${flag} needs a value.`);
    if (flags[flag] !== undefined) device[field] = field === "rotate" ? Number(flags[flag]) : flags[flag];
  }
  if (flags.width === true) fail("--width needs a number of pixels, or auto.");
  // What is set here is saved with the project, laid over what it had. The server says what it does not take.
  if (Object.keys(device).length || flags.width !== undefined) {
    const { project: current } = await (await request(config, "GET", projectRoute(project))).json();
    const next = { ...current.mockups, device: { ...current.mockups?.device, ...device } };
    if (flags.width === "auto") delete next.width;
    else if (flags.width !== undefined) next.width = Number(flags.width);
    await request(config, "PUT", projectRoute(project), { body: JSON.stringify({ mockups: next }), headers: { "content-type": "application/json" } });
  }

  const outDir = path.resolve(typeof flags.out === "string" ? flags.out : path.join("mockups", project));
  const language = shotLanguage(flags);
  const files = await download(config, projectRoute(project, `/mockups.zip${language ? `?locale=${encodeURIComponent(language)}` : ""}`), outDir);
  const count = files.filter((name) => name.endsWith(".png")).length;
  console.log(`${count ? `${count} mockup${count === 1 ? " is" : "s are"}` : "The mockups are"} in ${outDir}`);
}

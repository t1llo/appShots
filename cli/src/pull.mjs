import { lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
 * Whether a path from the list of an earlier download is a file inside the folder, whatever the list says.
 * @param {unknown} name
 * @returns {name is string}
 */
function insideFolder(name) {
  if (typeof name !== "string" || name === "" || name === MANIFEST || path.isAbsolute(name)) return false;
  const parts = path.normalize(name).split(/[/\\]/);
  return !parts.includes("..") && !parts.includes(".");
}

/**
 * Takes out the folders above a file that are left empty, up to the folder the download went into. Finder's
 * own .DS_Store does not count as something left in one.
 * @param {string} outDir
 * @param {string} dir
 */
function pruneEmpty(outDir, dir) {
  while (dir.startsWith(`${outDir}${path.sep}`)) {
    const left = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.name !== ".DS_Store" || entry.isDirectory());
    if (left.length > 0) return;
    rmSync(dir, { recursive: true, force: true });
    dir = path.dirname(dir);
  }
}

/**
 * Unpacks a download into a folder. Its files replace those of the same names, and the files an earlier
 * download put there that this one no longer has are taken out, so a slide or a language that is gone leaves no
 * picture behind for 'store push' to upload. Anything else in the folder stays, also inside the folders the
 * download writes, since --out may point at a folder that holds more than this.
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
    const earlier = readJson(path.join(outDir, MANIFEST))?.files;
    const kept = new Set(files);
    // Before the new files go in: on a disk that ignores case, 01-Home.png going would otherwise take a new 01-home.png with it.
    for (const name of Array.isArray(earlier) ? earlier.filter(insideFolder) : []) {
      if (kept.has(path.normalize(name))) continue;
      const file = path.join(outDir, name);
      const found = lstatSync(file, { throwIfNoEntry: false });
      if (!found || found.isDirectory()) continue;
      rmSync(file, { force: true });
      pruneEmpty(outDir, path.dirname(file));
    }
    for (const name of files) {
      const file = path.join(outDir, name);
      mkdirSync(path.dirname(file), { recursive: true });
      renameSync(path.join(staging, name), file);
    }
    writeFileSync(path.join(outDir, MANIFEST), `${JSON.stringify({ files }, null, 2)}\n`);
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
 * Renders the project and says what the render warned about, such as copy that had to shrink to fit or that the
 * App Store does not accept.
 * @param {Config} config
 * @param {string} project
 */
async function renderWithWarnings(config, project) {
  const response = await request(config, "POST", projectRoute(project, "/render"), { body: "{}", headers: { "content-type": "application/json" } });
  /** @type {{ warnings?: unknown }} */
  const result = await response.json().catch(() => ({}));
  const warnings = Array.isArray(result.warnings) ? result.warnings.filter((warning) => typeof warning === "string") : [];
  if (warnings.length) console.log(["Warnings from the render:", ...warnings.map((warning) => `- ${warning}`)].join("\n"));
}

/**
 * Downloads the rendered set as the server zips it and unpacks it into a folder, rendering it first when asked to.
 * @param {Config} config
 * @param {string} project
 * @param {string} outDir
 * @param {unknown} render
 */
export async function fetchExport(config, project, outDir, render) {
  if (render) await renderWithWarnings(config, project);
  return download(config, projectRoute(project, "/export.zip"), outDir);
}

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

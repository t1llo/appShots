import { accessSync, constants, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { attempt, fail } from "../fail.mjs";
import { run } from "../proc.mjs";
import { promptLine } from "../prompt.mjs";

/**
 * @typedef {object} Tools
 * @property {string} ffmpeg The program's file.
 * @property {string} ffprobe
 * @property {string | null} version As ffmpeg says it, such as "9.0.2"; null for a build that names no release.
 * @property {Set<string>} encoders
 * @property {Set<string>} filters
 * @property {"libx264" | "h264_videotoolbox" | null} h264 The H.264 encoder to cut with: x264 where there is one.
 * @property {NodeJS.ProcessEnv} [env] What the programs need in their environment besides the user's, when they
 *   are Remotion's: they load their libraries from their own folder. toolEnv() adds it.
 * @property {"APPSHOTS_FFMPEG" | "PATH" | "Homebrew" | "Remotion"} from Where they were found.
 *
 * @typedef {"compose" | "sheet" | "poster" | "probe"} Need
 * @typedef {(question: string) => Promise<boolean | null>} Ask A yes or no, or null when there is nobody to ask.
 */

/** The oldest ffmpeg with xfade, which joins the scenes. Nothing else needs a recent one. */
const OLDEST = [4, 3];

/**
 * What each use asks of ffmpeg: "h264" is either encoder. Homebrew's ffmpeg has all of it; a build without some
 * of it is refused before the work starts, rather than failing halfway through a compose.
 * @type {Record<Need, { encoders: string[], filters: string[] }>}
 */
export const NEEDS = {
  compose: {
    encoders: ["h264", "aac", "png"],
    filters: ["xfade", "tpad", "setparams", "overlay", "fade", "scale", "crop", "fps", "trim", "setpts", "freezedetect", "anullsrc", "afade", "atrim", "loudnorm", "aformat", "tile", "transpose"],
  },
  sheet: { encoders: ["png"], filters: ["fps", "scale", "pad", "tile", "vstack"] },
  poster: { encoders: ["png"], filters: [] },
  probe: { encoders: [], filters: [] },
};

/** What each use does, for the question before an install. */
const PURPOSE = { compose: "cut the video", sheet: "make the contact sheet", poster: "take the poster frame", probe: "read the video" };

/** Where Homebrew puts programs, on Apple silicon and on Intel. An agent's shell often has neither on its PATH. A test points it elsewhere. */
export const homebrew = { bins: ["/opt/homebrew/bin", "/usr/local/bin"] };

const INSTALL = "brew install ffmpeg";
const NO_HOMEBREW =
  "ffmpeg is not installed, and there is no Homebrew on this Mac to install it with. The troubleshooting page of the appShots docs (/docs/troubleshooting) says how to get it; APPSHOTS_FFMPEG and APPSHOTS_FFPROBE point appshots at programs anywhere.";
const NO_TERMINAL = `ffmpeg is not installed. Ask the user whether to install it, then run: ${INSTALL}`;

/** @type {Map<string, Promise<Tools>>} */
const inspected = new Map();

/** @param {string} file */
function runnable(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** @param {string} name */
const onPath = (name) =>
  (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, name))
    .find(runnable) ?? null;

/** @param {string} name */
const inHomebrew = (name) => homebrew.bins.map((dir) => path.join(dir, name)).find(runnable) ?? null;

/** Homebrew's own program, or null when it is not installed. */
export const findBrew = () => onPath("brew") ?? inHomebrew("brew");

/**
 * Remotion's ffmpeg and ffprobe, which come with its compositor package when the user installed Remotion into
 * the work folder (`appshots video remotion`). They are built to load the libraries beside them.
 * @param {string | undefined} root The work folder, appshots-video/, or the folder of the plan that has it.
 * @returns {{ ffmpeg: string, ffprobe: string, env: NodeJS.ProcessEnv } | null}
 */
function inRemotion(root) {
  if (!root) return null;
  const own = `compositor-${process.platform}-${process.arch}`;
  for (const work of [root, path.join(root, "appshots-video")]) {
    const scope = path.join(work, "remotion", "node_modules", "@remotion");
    let packages = [];
    try {
      packages = readdirSync(scope).filter((name) => name.startsWith("compositor-"));
    } catch {
      continue;
    }
    // npm installs the one for this Mac; another one copied along could not run here.
    packages.sort((a, b) => Number(b.startsWith(own)) - Number(a.startsWith(own)));
    const found = remotionTools(scope, packages);
    if (found) return found;
  }
  return null;
}

/**
 * @param {string} scope
 * @param {string[]} packages
 */
function remotionTools(scope, packages) {
  for (const name of packages) {
    const dir = path.join(scope, name);
    const ffmpeg = path.join(dir, "ffmpeg");
    const ffprobe = path.join(dir, "ffprobe");
    if (!runnable(ffmpeg) || !runnable(ffprobe)) continue;
    const library = process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
    return { ffmpeg, ffprobe, env: { [library]: dir } };
  }
  return null;
}

/**
 * Where ffmpeg and ffprobe are, in this order: APPSHOTS_FFMPEG and APPSHOTS_FFPROBE, the PATH, Homebrew's folders,
 * then Remotion's in the work folder. An ffprobe is looked for beside the ffmpeg first, so the two match.
 * @param {string | undefined} root
 * @returns {{ ffmpeg: string, ffprobe: string, env?: NodeJS.ProcessEnv, from: Tools["from"] } | null}
 */
function locate(root) {
  const given = process.env.APPSHOTS_FFMPEG;
  const givenProbe = process.env.APPSHOTS_FFPROBE;
  for (const [name, file] of [["APPSHOTS_FFMPEG", given], ["APPSHOTS_FFPROBE", givenProbe]]) {
    if (file && !runnable(file)) fail(`${name} is ${file}, and there is no program there.`);
  }
  const beside = (/** @type {string} */ ffmpeg) => {
    const ffprobe = path.join(path.dirname(ffmpeg), "ffprobe");
    return runnable(ffprobe) ? ffprobe : null;
  };
  if (given) {
    const ffprobe = givenProbe ?? beside(given) ?? onPath("ffprobe") ?? inHomebrew("ffprobe");
    if (!ffprobe) fail(`There is no ffprobe beside ${given}. Point APPSHOTS_FFPROBE at the ffprobe that goes with it.`);
    return { ffmpeg: given, ffprobe, from: "APPSHOTS_FFMPEG" };
  }
  for (const [find, from] of /** @type {const} */ ([[onPath, "PATH"], [inHomebrew, "Homebrew"]])) {
    const ffmpeg = find("ffmpeg");
    const ffprobe = givenProbe ?? (ffmpeg && beside(ffmpeg)) ?? find("ffprobe");
    if (ffmpeg && ffprobe) return { ffmpeg, ffprobe, from };
  }
  const remotion = inRemotion(root);
  return remotion ? { ...remotion, from: "Remotion" } : null;
}

/**
 * The environment to run a found program in: the user's own, plus what Remotion's programs need.
 * @param {{ env?: NodeJS.ProcessEnv }} tools
 * @returns {NodeJS.ProcessEnv | undefined}
 */
export const toolEnv = (tools) => (tools.env ? { ...process.env, ...tools.env } : undefined);

/**
 * The names in the first column of ffmpeg's -encoders or -filters list, under its legend.
 * @param {string} listing
 */
function listed(listing) {
  const names = new Set();
  for (const line of listing.split("\n")) {
    const match = /^\s*[A-Z.|]{2,6}\s+(\w+)\s/.exec(line);
    if (match && match[1] !== "=") names.add(match[1]);
  }
  return names;
}

/**
 * Asks ffmpeg once what it is and what it has.
 * @param {{ ffmpeg: string, ffprobe: string, env?: NodeJS.ProcessEnv, from: Tools["from"] }} found
 * @returns {Promise<Tools>}
 */
async function inspect(found) {
  const env = toolEnv(found);
  const [version, encoders, filters, probe] = await Promise.all([
    run(found.ffmpeg, ["-hide_banner", "-version"], { env }),
    run(found.ffmpeg, ["-hide_banner", "-encoders"], { env }),
    run(found.ffmpeg, ["-hide_banner", "-filters"], { env }),
    run(found.ffprobe, ["-hide_banner", "-version"], { env }),
  ]);
  for (const [file, result] of [[found.ffmpeg, version], [found.ffprobe, probe]]) {
    if (result.status !== 0) {
      const said = (result.stderr || result.error?.message || "").trim().split("\n").pop();
      fail(`${file} does not start${said ? `: ${said}` : ""}. Install ffmpeg again (${INSTALL}), or point APPSHOTS_FFMPEG at one that works.`);
    }
  }
  const named = /version n?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version.stdout.split("\n")[0] ?? "");
  const encoderSet = listed(encoders.stdout);
  return {
    ffmpeg: found.ffmpeg,
    ffprobe: found.ffprobe,
    version: named ? named.slice(1).filter(Boolean).join(".") : null,
    encoders: encoderSet,
    filters: listed(filters.stdout),
    h264: encoderSet.has("libx264") ? "libx264" : encoderSet.has("h264_videotoolbox") ? "h264_videotoolbox" : null,
    ...(found.env ? { env: found.env } : {}),
    from: found.from,
  };
}

/**
 * What a found ffmpeg lacks for a use, as the names to say: a version that is too old, encoders, filters.
 * @param {Tools} tools
 * @param {Need} need
 */
export function lacking(tools, need) {
  const missing = [];
  const numbers = tools.version?.split(".").map(Number);
  const old = numbers && (numbers[0] < OLDEST[0] || (numbers[0] === OLDEST[0] && numbers[1] < OLDEST[1]));
  if (need === "compose" && old) missing.push(`version ${OLDEST.join(".")} or newer`);
  for (const encoder of NEEDS[need].encoders) {
    if (encoder === "h264" ? !tools.h264 : !tools.encoders.has(encoder)) missing.push(encoder === "h264" ? "an H.264 encoder (libx264 or h264_videotoolbox)" : `the ${encoder} encoder`);
  }
  const filters = NEEDS[need].filters.filter((filter) => !tools.filters.has(filter));
  if (filters.length > 0) missing.push(`the filter${filters.length > 1 ? "s" : ""} ${filters.join(", ")}`);
  return missing;
}

/**
 * Asks the person at the Terminal for a yes; Return alone is a no. Null without a terminal.
 * @type {Ask}
 */
async function askTerminal(question) {
  if (!process.stdin.isTTY) return null;
  return /^y(es)?$/i.test(await promptLine(`${question} [y/N] `, NO_TERMINAL));
}

/**
 * Installs ffmpeg with Homebrew, after a yes. Nothing is installed without one: without a terminal, or with
 * `ask: false`, it fails with what to ask the user instead.
 * @param {Ask | boolean} ask
 * @param {Need} need
 */
async function install(ask, need) {
  const brew = findBrew();
  if (!brew) fail(NO_HOMEBREW);
  const question = `ffmpeg is needed to ${PURPOSE[need]} and is not on this Mac. Install it with Homebrew now (${INSTALL}, about 100 MB)?`;
  const answer = ask === false ? null : await (typeof ask === "function" ? ask : askTerminal)(question);
  if (answer === null) fail(NO_TERMINAL);
  if (!answer) fail(`ffmpeg is needed to ${PURPOSE[need]}. Install it with '${INSTALL}' when you want to, then run this again.`);
  const result = await run(brew, ["install", "ffmpeg"], { timeout: 0, stdio: "inherit" });
  if (result.status !== 0) fail(`'${INSTALL}' did not finish${result.status === null ? "" : ` (exit ${result.status})`}. Run it in a Terminal to see why, then try again.`);
}

/**
 * Finds ffmpeg and ffprobe and checks that they can do what `need` asks, once per run. When there is none, it
 * offers to install Homebrew's after a yes; it never installs without one.
 * @param {object} [options]
 * @param {string} [options.root] The work folder, appshots-video/, where Remotion's ffmpeg may be.
 * @param {Ask | boolean} [options.ask] Who answers the install question: a function, the person at the Terminal
 *   (true, the default) or nobody (false), when the command only reports.
 * @param {Need} [options.need] What the programs are for; a compose asks the most of them.
 * @returns {Promise<Tools>}
 */
export async function findFfmpeg({ root, ask = true, need = "compose" } = {}) {
  let found = locate(root);
  if (!found) {
    await install(ask, need);
    found = locate(root);
    if (!found) fail(`Homebrew installed ffmpeg, but appshots does not find it in ${homebrew.bins.join(" or ")}. Open a new Terminal and run this again, or point APPSHOTS_FFMPEG at it.`);
  }
  const key = `${found.ffmpeg}\n${found.ffprobe}`;
  if (!inspected.has(key)) inspected.set(key, inspect(found));
  const pending = /** @type {Promise<Tools>} */ (inspected.get(key));
  // A program that did not start is asked again next time, as it may have been installed in between.
  const tools = await pending.catch((error) => {
    inspected.delete(key);
    throw error;
  });
  const missing = lacking(tools, need);
  if (missing.length > 0) {
    const upgrade = tools.from === "Homebrew" ? "'brew upgrade ffmpeg' brings Homebrew's up to date" : `Homebrew's ffmpeg has all of it (${INSTALL})`;
    fail(`The ffmpeg at ${tools.ffmpeg}${tools.version ? ` (${tools.version})` : ""} has no ${missing.join(", no ")}. ${upgrade}; APPSHOTS_FFMPEG points appshots at another build.`);
  }
  return tools;
}

/**
 * One line for 'appshots check': what ffmpeg there is and whether it can cut a preview. It never asks and never
 * installs.
 * @param {string} [root]
 */
export async function ffmpegStatus(root) {
  const located = await attempt(() => locate(root));
  if (located.problem !== undefined) return located.problem;
  if (!located.value) {
    return findBrew()
      ? `not installed; only app preview videos need it. '${INSTALL}' installs it, and 'appshots video compose' asks before it does.`
      : "not installed; only app preview videos need it. There is no Homebrew to install it with: the troubleshooting page of the docs says how to get it.";
  }
  const found = await attempt(() => findFfmpeg({ root, ask: false, need: "probe" }));
  if (found.problem !== undefined) return found.problem;
  const tools = found.value;
  const missing = lacking(tools, "compose");
  const what = `${tools.ffmpeg}${tools.version ? `, version ${tools.version}` : ""}${tools.from === "Remotion" ? ", Remotion's" : ""}`;
  if (missing.length > 0) return `${what}, without ${missing.join(", ")}, so it cannot cut a preview. ${tools.from === "Homebrew" ? "'brew upgrade ffmpeg'" : `'${INSTALL}'`} brings one that can.`;
  return `${what}, with ${tools.h264} and every filter 'appshots video compose' needs`;
}

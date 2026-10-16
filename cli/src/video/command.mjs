// `appshots video`: app preview videos, from the plan to App Store Connect. Each sub-action is one step of the
// playbook `appshots video guide` prints. The plan, the storyboard and the layers are here; recording, cutting,
// checking and uploading are steps of their own, each loaded only when it runs.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoute, request } from "../api.mjs";
import { loadConfig } from "../config.mjs";
import { attempt, fail } from "../fail.mjs";
import { run } from "../proc.mjs";
import { xcrun } from "../xcode.mjs";
import { guide } from "./guide.mjs";
import { initPlan } from "./init.mjs";
import { layersCommand } from "./layers.mjs";
import { PLAN_FILE, WORK_FOLDER, readPlan, resolvePlan, selectedDisplays, selectedLocales, selectedScenes, shown, workFolders } from "./plan.mjs";
import { buildStoryboard, storyboardText } from "./storyboard.mjs";

/** @typedef {import("./plan.mjs").Plan} Plan */
/** @typedef {Record<string, string | true>} Flags */

/**
 * The steps the other parts of the CLI hold, loaded when they run. Each import names its module outright, so that
 * the build puts it into the one file; a build made without one of them has an empty module in its place.
 * @type {Record<string, () => Promise<Record<string, unknown>>>}
 */
const STEPS = {
  recordScenes: () => import("./record/index.mjs"),
  readSidecar: () => import("./record/index.mjs"),
  importFootage: () => import("./import.mjs"),
  compose: () => import("./compose.mjs"),
  checkFiles: () => import("./check.mjs"),
  contactSheet: () => import("./sheet.mjs"),
  choosePoster: () => import("./poster.mjs"),
  findFfmpeg: () => import("./ffmpeg.mjs"),
  ffmpegStatus: () => import("./ffmpeg.mjs"),
  videoPush: () => import("./push.mjs"),
  scaffoldRemotion: () => import("./remotion.mjs"),
};

/**
 * A step by the name of the function that does it, or null when this build has none.
 * @param {keyof typeof STEPS} name
 * @returns {Promise<((...args: any[]) => any) | null>}
 */
export async function optionalStep(name) {
  let module;
  try {
    module = await STEPS[name]();
  } catch (error) {
    // Run from the sources, a step that is not written yet is a file that is not there. A file that a step itself
    // imports and that is not there is a fault in that step, so it is said as it is.
    if (missingHere(error)) return null;
    throw error;
  }
  const found = module[name];
  return typeof found === "function" ? /** @type {(...args: any[]) => any} */ (found) : null;
}

/**
 * Whether an import failed because a module this file names is not there. Node says which file named it only in the
 * message, as "Cannot find module '<file>' imported from <this file>".
 * @param {unknown} error
 */
function missingHere(error) {
  const { code, message } = /** @type {{ code?: unknown, message?: unknown }} */ (error ?? {});
  return code === "ERR_MODULE_NOT_FOUND" && typeof message === "string" && message.includes(` imported from ${fileURLToPath(import.meta.url)}`);
}

/**
 * A step the sub-action cannot do without.
 * @param {keyof typeof STEPS} name
 * @param {string} action
 */
async function step(name, action) {
  return (await optionalStep(name)) ?? fail(`'appshots video ${action}' is not available in this build of appshots. 'appshots update' brings this CLI up to date with the server's.`);
}

/**
 * @typedef {object} Action
 * @property {string[]} flags
 * @property {string} usage
 * @property {(rest: string[], flags: Flags) => Promise<unknown> | unknown} run
 */

/** @type {Record<string, Action>} */
export const VIDEO_ACTIONS = {
  init: {
    flags: ["plan", "display", "lang", "again"],
    usage: "init [project] [--plan <file>] [--display iphone,ipad,mac] [--lang <codes>] [--again]",
    run: (rest, flags) => {
      if (rest.length > 1) fail(usageOf("init"));
      return initPlan(rest[0], flags);
    },
  },
  plan: { flags: ["plan", "json"], usage: "plan [--plan <file>] [--json]", run: (rest, flags) => (rest.length > 0 ? fail(usageOf("plan")) : storyboard(flags)) },
  record: {
    flags: ["plan", "scene", "lang", "display", "sim", "device", "mac", "web", "realtime", "manual", "seconds", "window", "again", "reuse-footage"],
    usage: "record [--scene <ids>] [--lang <codes>] [--display <keys>] [--sim [name] | --device [name] | --mac [app] | --web <url>] [--realtime] [--manual] [--seconds <n>] [--window <WxH>] [--again] [--reuse-footage]",
    run: async (rest, flags) => {
      if (rest.length > 0) fail(usageOf("record"));
      const recordScenes = await step("recordScenes", "record");
      const plan = await loadPlan(flags);
      return recordScenes(plan, picked(plan, flags));
    },
  },
  import: {
    flags: ["plan", "scene", "lang", "display"],
    usage: "import <file> --scene <id> [--lang <code>] [--display <key>]",
    run: async (rest, flags) => {
      if (rest.length !== 1) fail(usageOf("import"));
      const importFootage = await step("importFootage", "import");
      const plan = await loadPlan(flags);
      return importFootage(plan, rest[0], picked(plan, flags));
    },
  },
  layers: {
    flags: ["plan", "lang", "display"],
    usage: "layers [--lang <codes>] [--display <keys>]",
    run: async (rest, flags) => {
      if (rest.length > 0) fail(usageOf("layers"));
      // The server takes the languages as the project writes them, so they are made the project's first.
      const given = readPlanFlag(flags);
      const plan = resolvePlan(given, await fetchProject(given.project));
      return layersCommand(plan, { displays: selectedDisplays(plan, flags), locales: selectedLocales(plan, flags) });
    },
  },
  compose: {
    flags: ["plan", "lang", "display", "engine", "draft", "jobs"],
    usage: "compose [--lang <codes>] [--display <keys>] [--engine ffmpeg|remotion] [--draft] [--jobs <n>]",
    run: async (rest, flags) => {
      if (rest.length > 0) fail(usageOf("compose"));
      const compose = await step("compose", "compose");
      const plan = await loadPlan(flags);
      return compose(plan, picked(plan, flags));
    },
  },
  check: { flags: ["plan", "display", "lang", "json"], usage: "check [files...] [--display <key>] [--json]", run: (rest, flags) => checkPreviews(rest, flags) },
  sheet: { flags: ["plan", "raw", "every", "lang", "display", "scene"], usage: "sheet [file] [--raw] [--scene <ids>] [--every <seconds>] [--lang <codes>] [--display <keys>]", run: (rest, flags) => sheet(rest, flags) },
  poster: { flags: ["plan", "at", "lang", "display"], usage: "poster --at <seconds> [file] [--lang <codes>] [--display <keys>]", run: (rest, flags) => poster(rest, flags) },
  remotion: {
    flags: ["plan", "yes", "no-install", "again", "replace"],
    usage: "remotion [--yes] [--no-install] [--again] [--replace]",
    run: async (rest, flags) => {
      if (rest.length > 0) fail(usageOf("remotion"));
      const scaffoldRemotion = await step("scaffoldRemotion", "remotion");
      return scaffoldRemotion(workFolderOf(flags), { yes: Boolean(flags.yes), install: !flags["no-install"], again: Boolean(flags.again), replace: Boolean(flags.replace) });
    },
  },
  push: {
    flags: ["plan", "app", "version", "lang", "display", "replace", "dry-run", "no-wait", "resume"],
    usage: "push [--app <bundle id>] [--version <v>] [--lang <codes>] [--display <keys>] [--replace] [--dry-run] [--no-wait] [--resume]",
    run: async (rest, flags) => {
      if (rest.length > 0) fail(usageOf("push"));
      const videoPush = await step("videoPush", "push");
      const plan = await loadPlan(flags);
      return videoPush(plan, picked(plan, flags));
    },
  },
  guide: { flags: [], usage: "guide", run: () => guide() },
};

/** Every flag a sub-action takes, for the command's entry: which one takes which is said by the sub-action. */
export const VIDEO_FLAGS = [...new Set(Object.values(VIDEO_ACTIONS).flatMap((action) => action.flags))];

/** @param {string} action */
const usageOf = (action) => `Usage: appshots video ${VIDEO_ACTIONS[action].usage}`;

export const VIDEO_USAGE = `Usage: appshots video ${Object.keys(VIDEO_ACTIONS).join(" | ")}. 'appshots help video' lists what each one takes.`;

/**
 * `appshots video <action>`.
 * @param {import("../args.mjs").Args} args
 */
export async function video({ positional: [action, ...rest], flags }) {
  const entry = action !== undefined && Object.hasOwn(VIDEO_ACTIONS, action) ? VIDEO_ACTIONS[action] : null;
  if (!entry) fail(VIDEO_USAGE);
  // A flag no sub-action takes is pointed out by main(); one that only another sub-action takes, here.
  const known = new Set(["help", ...entry.flags]);
  for (const flag of Object.keys(flags)) if (VIDEO_FLAGS.includes(flag) && !known.has(flag)) console.error(`appshots: video ${action} takes no --${flag}, so it is left out. 'appshots help video' lists what each one takes.`);
  return entry.run(rest, Object.fromEntries(Object.entries(flags).filter(([flag]) => known.has(flag))));
}

/** @param {Flags} flags */
function readPlanFlag(flags) {
  if (flags.plan === true) fail("--plan needs a file name, such as --plan appshots.video.json.");
  return readPlan(typeof flags.plan === "string" ? flags.plan : PLAN_FILE);
}

/** @param {Flags} flags */
const planFileOf = (flags) => path.resolve(typeof flags.plan === "string" ? flags.plan : PLAN_FILE);

/**
 * appshots-video/ beside the plan, for a step that needs no plan.
 * @param {Flags} flags
 */
const workFolderOf = (flags) => path.join(path.dirname(planFileOf(flags)), WORK_FOLDER);

/** @param {string} id */
async function fetchProject(id) {
  return /** @type {{ id: string, name: string, locales: string[], slides: any[] }} */ ((await (await request(loadConfig(), "GET", projectRoute(id))).json()).project);
}

/**
 * The plan --plan names, or appshots.video.json here. A plan that leaves its languages out has the project's, so
 * the project is asked for then; otherwise the steps run without the server.
 * @param {Flags} flags
 * @returns {Promise<Plan & { locales: string[] }>}
 */
async function loadPlan(flags) {
  const plan = readPlanFlag(flags);
  return plan.locales ? /** @type {Plan & { locales: string[] }} */ (plan) : resolvePlan(plan, await fetchProject(plan.project));
}

/**
 * The flags with --lang, --display and --scene checked against the plan before anything starts, and --lang
 * written as the plan writes its languages, for the steps that read them.
 * @param {Plan & { locales: string[] }} plan
 * @param {Flags} flags
 * @returns {Flags}
 */
function picked(plan, flags) {
  const locales = selectedLocales(plan, flags);
  selectedDisplays(plan, flags);
  if (typeof flags.scene === "string") selectedScenes(plan, flags);
  return typeof flags.lang === "string" ? { ...flags, lang: locales.join(",") } : flags;
}

/**
 * `appshots video plan`: checks the plan and prints its storyboard, or gives it as JSON. Without the server it
 * still runs, as far as a plan that names its languages goes; captions taken from slides then show as such.
 * @param {Flags} flags
 */
async function storyboard(flags) {
  const plan = readPlanFlag(flags);
  const fetched = await attempt(() => fetchProject(plan.project));
  if (fetched.problem !== undefined && !plan.locales) fail(`The plan takes its languages from project ${plan.project}, and that could not be read: ${fetched.problem}`);
  if (fetched.problem !== undefined) console.error(`appshots: project ${plan.project} could not be read, so the captions taken from its slides are not shown: ${fetched.problem}`);
  const project = fetched.value ?? null;
  const resolved = project ? resolvePlan(plan, project) : /** @type {Plan & { locales: string[] }} */ (plan);
  const readSidecar = await optionalStep("readSidecar");
  /** @type {(display: string, locale: string, scene: import("./plan.mjs").Scene) => any} */
  const recording = readSidecar ? (display, locale, scene) => readSidecar(resolved.root, display, locale, scene.id) : () => null;
  const board = buildStoryboard(resolved, { project, recording });
  console.log(flags.json ? JSON.stringify(board, null, 2) : storyboardText(board));
}

/**
 * The previews the compose made, for the displays and languages picked: out/<locale>/<display>/<name>.mp4.
 * @param {Plan & { locales: string[] }} plan
 * @param {Flags} flags
 */
function previews(plan, flags) {
  const { out } = workFolders(plan);
  const displays = selectedDisplays(plan, flags);
  const found = selectedLocales(plan, flags).flatMap((locale) => displays.map((display) => ({ locale, display, file: path.join(out, locale, display, `${plan.name}.mp4`) }))).filter(({ file }) => existsSync(file));
  if (found.length === 0) fail(`There is no preview in ${shown(out)} yet${flags.lang || flags.display ? " for what --lang and --display pick" : ""}. 'appshots video compose' makes them.`);
  return found;
}

/**
 * `appshots video check [files...]`: checks videos against Apple's specification; without files, the plan's
 * previews. Ends with 1 when any of them has an error.
 * @param {string[]} files
 * @param {Flags} flags
 */
async function checkPreviews(files, flags) {
  const checkFiles = await step("checkFiles", "check");
  if (flags.display === true) fail("--display needs the display the files are for, such as --display iphone.");
  if (files.length > 0) return checkFiles(files, { display: flags.display, json: Boolean(flags.json), root: workFolderOf(flags) });
  if (!existsSync(planFileOf(flags))) fail(`Name the videos to check: ${usageOf("check")}. Without them it checks the previews of ${path.basename(planFileOf(flags))}, and there is none here.`);
  const plan = await loadPlan(flags);
  const found = previews(plan, flags);
  // One display is said outright; several are told apart by their sizes.
  const displays = [...new Set(found.map((each) => each.display))];
  return checkFiles(found.map((each) => shown(each.file)), { display: displays.length === 1 ? displays[0] : undefined, json: Boolean(flags.json), root: workFolders(plan).work });
}

/**
 * `appshots video sheet [file]`: a contact sheet of a video, of each preview, or with --raw of the recordings of
 * each display and language, one block of rows per recording in the plan's order.
 * @param {string[]} rest
 * @param {Flags} flags
 */
async function sheet(rest, flags) {
  if (rest.length > 1 || (rest.length === 1 && flags.raw)) fail(`${usageOf("sheet")}. A file or --raw, not both.`);
  const every = flags.every === undefined ? 1 : Number(flags.every);
  if (!(every > 0 && every <= 60)) fail("--every takes the seconds between pictures, such as --every 1 or --every 0.5.");
  const contactSheet = await step("contactSheet", "sheet");
  const findFfmpeg = await step("findFfmpeg", "sheet");

  /** @type {Array<{ files: string[], labels: string[], out: string }>} */
  let sheets;
  let root = workFolderOf(flags);
  if (rest.length === 1) {
    const file = path.resolve(rest[0]);
    if (!existsSync(file)) fail(`There is no video at ${rest[0]}.`);
    sheets = [{ files: [file], labels: [path.basename(file)], out: `${file.replace(/\.[^./]+$/, "")}.sheet.png` }];
  } else {
    const plan = await loadPlan(flags);
    root = workFolders(plan).work;
    if (flags.raw) {
      const readSidecar = await step("readSidecar", "sheet --raw");
      const scenes = selectedScenes(plan, flags);
      sheets = [];
      for (const display of selectedDisplays(plan, flags)) {
        for (const locale of selectedLocales(plan, flags)) {
          // A language that shows another one's footage has no recordings of its own to look at.
          const own = scenes.map((scene) => ({ scene, sidecar: readSidecar(plan.root, display, locale, scene.id) })).filter(({ sidecar }) => sidecar?.file && !sidecar.reuse);
          if (own.length > 0) sheets.push({ files: own.map(({ sidecar }) => sidecar.file), labels: own.map(({ scene }) => scene.id), out: path.join(workFolders(plan).raw, display, locale, "sheet.png") });
        }
      }
      if (sheets.length === 0) fail("There are no recordings yet for what is picked. 'appshots video record' makes them.");
    } else {
      sheets = previews(plan, flags).map(({ file }) => ({ files: [file], labels: [path.basename(file)], out: `${file.replace(/\.mp4$/, "")}.sheet.png` }));
    }
  }
  if (flags.scene && !flags.raw) console.error("appshots: --scene picks recordings for --raw, so it is left out.");

  const tools = await findFfmpeg({ root, need: "sheet" });
  for (const each of sheets) {
    const made = await contactSheet(each.files, each.out, { every }, tools);
    const rows = /** @type {Array<{ rows: number }>} */ (made.blocks ?? []);
    const order = each.files.length > 1 && rows.length === each.files.length ? `; top to bottom: ${rows.map((block, at) => `${each.labels[at]} (${block.rows} row${block.rows === 1 ? "" : "s"})`).join(", ")}` : "";
    console.log(`${shown(made.file ?? each.out)}: a picture every ${every} s${order}`);
  }
}

/**
 * `appshots video poster --at <seconds> [file]`: takes the poster of each preview, or of one, at another time,
 * and keeps that time for the upload.
 * @param {string[]} rest
 * @param {Flags} flags
 */
async function poster(rest, flags) {
  if (rest.length > 1 || flags.at === undefined || flags.at === true) fail(`${usageOf("poster")}. --at is the seconds into the preview of the frame that shows before it plays.`);
  const seconds = Number(flags.at);
  if (!(seconds >= 0)) fail("--at takes the seconds into the preview, such as --at 4.5.");
  const choosePoster = await step("choosePoster", "poster");
  const findFfmpeg = await step("findFfmpeg", "poster");
  let files;
  let root = workFolderOf(flags);
  if (rest.length === 1) {
    files = [path.resolve(rest[0])];
    if (!existsSync(files[0])) fail(`There is no video at ${rest[0]}.`);
  } else {
    const plan = await loadPlan(flags);
    root = workFolders(plan).work;
    files = previews(plan, flags).map(({ file }) => file);
  }
  const tools = await findFfmpeg({ root, need: "poster" });
  for (const file of files) {
    const made = await choosePoster(file, seconds, tools);
    console.log(`${shown(made.file)}: the frame at ${made.seconds.toFixed(2)} s (${made.timecode}), which 'appshots video push' gives App Store Connect as the poster`);
  }
}

/** The ffmpeg line of 'appshots check', or null in a build without the video steps. It never asks or installs. */
export async function ffmpegLine() {
  const status = await optionalStep("ffmpegStatus");
  return status ? /** @type {string} */ (await status(path.join(process.cwd(), WORK_FOLDER))) : null;
}

/**
 * Whether the app this runs in may record the screen, which taking a Mac app's window needs. It asks macOS
 * without making it show the request. Null when that cannot be told.
 */
export async function screenRecordingLine() {
  const script = "ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]); $.CGPreflightScreenCaptureAccess()";
  const answer = (await run("osascript", ["-l", "JavaScript", "-e", script])).stdout.trim();
  if (answer === "true") return "allowed, which capturing or recording a Mac app's window needs";
  if (answer === "false") return "not allowed for the app this runs in. Only capturing or recording a Mac app's window needs it: allow it under System Settings > Privacy & Security > Screen & System Audio Recording, then open the terminal again";
  return null;
}

/** Whether this Xcode's devicectl can record a connected device's screen, for 'appshots video record --device'. */
export async function deviceRecordingLine() {
  const result = await xcrun(["devicectl", "device", "capture", "--help"], { timeout: 15000 });
  return /\bscreen-record\b/.test(`${result.stdout}\n${result.stderr}`)
    ? "devicectl can record a connected iPhone's or iPad's screen for 'appshots video record --device' (experimental; the simulator is the surer source)"
    : "this Xcode's devicectl cannot record a device's screen. Record it with QuickTime Player (File > New Movie Recording, the iPhone as camera) and bring it in with 'appshots video import'";
}

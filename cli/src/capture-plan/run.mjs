import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { projectRoute, request } from "../api.mjs";
import { build, pickScheme } from "../build.mjs";
import { BLANK_WAIT, captureSettled, withCleanStatusBar } from "../capture/sim.mjs";
import { loadConfig } from "../config.mjs";
import { attempt, fail } from "../fail.mjs";
import { fromHere, xcodeProjects } from "../projects.mjs";
import { availableSimulators, boot, install, simulatorLabel } from "../sim.mjs";
import { upload } from "../upload.mjs";
import { slugify } from "../util.mjs";
import { xcrun } from "../xcode.mjs";
import { importFastlane } from "./fastlane.mjs";
import { languageArguments, pickSimulator, planJobs, reachLabel, runLocales, runScreens, screenApp } from "./jobs.mjs";
import { PLAN_FILE, readPlan } from "./read.mjs";
import { buildForTesting, runUITest } from "./uitest.mjs";

/** @typedef {import("./read.mjs").Plan} Plan */
/** @typedef {import("./jobs.mjs").Job} Job */
/** @typedef {import("../sim.mjs").Simulator} Simulator */
/** @typedef {import("../config.mjs").Config} Config */

const USAGE = "Usage: appshots shoot [<project>] --plan [<file>] [--only <screens>] [--lang <codes>] [--again] [--dry-run], or appshots shoot [<project>] --fastlane <dir> [--dry-run]";

// What a person shooting by hand picks; a plan says it itself.
const BY_HAND = ["sim", "device", "mac", "web", "clean", "out", "as", "ipad", "duo"];

/** A device stops being used after this many screens in a row have failed on it: what is wrong is not the screens. */
const FAILURES_IN_A_ROW = 3;

/** What a simulator opens a web link in when no app is started for it. */
const SAFARI = "com.apple.mobilesafari";

/**
 * The project as the server has it: its languages, and the screenshots it has already.
 * @param {Config} config
 * @param {string} id
 * @returns {Promise<{ project: { locales: string[] }, shots: Array<{ name: string, device: string, locale?: string }> }>}
 */
async function fetchProject(config, id) {
  return (await request(config, "GET", projectRoute(id))).json();
}

/** @param {number} n */
const count = (n) => `${n} ${n === 1 ? "screenshot" : "screenshots"}`;

/** @param {string[]} words */
const and = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

/**
 * The Xcode workspace or project a plan builds: the one app.xcode names, or the one in the folder it names or in
 * the plan's folder.
 * @param {Plan} plan
 * @param {string} why What it is needed for, for the message when there is none.
 */
function planXcodeProject(plan, why) {
  const given = plan.app.xcode ?? plan.dir;
  if (!existsSync(given)) fail(`app.xcode in ${plan.file}: there is no ${fromHere(given)}.`);
  if (/\.(xcworkspace|xcodeproj)\/?$/.test(given)) return given;
  if (!statSync(given).isDirectory()) fail(`app.xcode in ${plan.file}: ${fromHere(given)} is no Xcode workspace or project, nor a folder with one.`);
  const found = xcodeProjects([given]);
  if (found.length === 1) return found[0];
  const where = `Name it in app.xcode of ${plan.file}, as in "ios/App.xcworkspace"`;
  if (found.length === 0) fail(`${why} needs the app's Xcode project, and there is none in ${fromHere(given)}. ${where}.`);
  fail(`${why} needs the app's Xcode project, and ${fromHere(given)} has several. ${where}:\n${found.map((file) => `  ${fromHere(file)}`).join("\n")}`);
}

/**
 * The simulator's appearance as it is, to put it back after the run. Null when it does not say.
 * @param {Simulator} simulator
 */
async function appearanceOf(simulator) {
  const result = await xcrun(["simctl", "ui", simulator.udid, "appearance"]);
  const said = result.stdout.trim();
  return result.status === 0 && (said === "light" || said === "dark") ? said : null;
}

/**
 * @param {Simulator} simulator
 * @param {"light" | "dark"} appearance
 */
async function setAppearance(simulator, appearance) {
  const result = await xcrun(["simctl", "ui", simulator.udid, "appearance", appearance]);
  if (result.status !== 0) fail(`Could not set ${simulator.name} to ${appearance}:\n${result.stderr.trim()}`);
}

/**
 * Says which of the apps the screens start is not on a simulator, before any screen is taken.
 * @param {Simulator} simulator
 * @param {string[]} apps
 * @param {Plan} plan
 */
async function checkInstalled(simulator, apps, plan) {
  for (const app of apps) {
    const result = await xcrun(["simctl", "get_app_container", simulator.udid, app]);
    if (result.status === 0) continue;
    const how = plan.app.xcode ? "" : ` Build and install it there with 'appshots run --sim ${simulator.udid}', or name the Xcode project in app.xcode of ${plan.file}, and the plan builds it.`;
    fail(`${app} is not installed on ${simulator.name}.${how}`);
  }
}

/**
 * @typedef {object} Run
 * @property {Plan} plan
 * @property {Config} config
 * @property {string} project
 * @property {string} [bundleId]
 * @property {string} [xcodeProject]
 * @property {string} [scheme]
 * @property {Map<string, string>} started The app the last screen brought to the front on each simulator, by its udid.
 */

/**
 * Closes the app the last screen brought to the front on a simulator, if there is one.
 * @param {Run} run
 * @param {Simulator} simulator
 */
async function closeStarted(run, simulator) {
  const app = run.started.get(simulator.udid);
  if (!app) return;
  await xcrun(["simctl", "terminate", simulator.udid, app]);
  run.started.delete(simulator.udid);
}

/**
 * Brings up the screen of one job, takes it once it has come to rest, and uploads it.
 * @param {Run} run
 * @param {Job} job
 * @param {Simulator} simulator
 */
async function take(run, job, simulator) {
  const { plan } = run;
  const { screen } = job;
  const wait = screen.wait ?? plan.wait;
  mkdirSync(path.dirname(job.file), { recursive: true });
  const app = screenApp(plan, screen, run.bundleId);
  // An app started while another is in front shows a link back to that one in the status bar, so the one the last
  // screen brought to the front is closed first, unless it is the same. A web link with no app comes up in Safari;
  // what takes another link with no app is not known here, which is why the docs ask to name it in screens[].app.
  const front = app ?? (screen.url && /^https?:/i.test(screen.url) ? SAFARI : undefined);
  if (run.started.get(simulator.udid) !== front) await closeStarted(run, simulator);
  let blank = false;
  if (screen.uitest && run.xcodeProject && run.scheme) {
    const options = { project: run.xcodeProject, scheme: run.scheme, test: screen.uitest, simulator, locale: job.locale };
    await runUITest(options, async () => {
      blank = await captureSettled(simulator, job.file, wait);
    });
  } else {
    // Noted before it is started: a launch or a link that fails or runs out of time can have brought it up all the same.
    if (front) run.started.set(simulator.udid, front);
    if (app) {
      const args = [...(screen.app ? [] : plan.app.args), ...screen.args, ...languageArguments(job.locale)];
      // One that is still running would come to the front with the arguments it was started with.
      const result = await xcrun(["simctl", "launch", "--terminate-running-process", simulator.udid, app, ...args]);
      if (result.status !== 0) fail(`Could not launch ${app} on ${simulator.name}:\n${result.stderr.trim()}`);
    }
    if (screen.url) {
      const result = await xcrun(["simctl", "openurl", simulator.udid, screen.url]);
      if (result.status !== 0) fail(`Could not open ${screen.url} on ${simulator.name}${app ? `. Does ${app} take that link?` : ""}\n${result.stderr.trim()}`);
    }
    blank = await captureSettled(simulator, job.file, wait);
  }
  // Most likely the launch screen or a page still loading, which a later run would skip once it was uploaded.
  if (blank) fail(`${simulator.name} still showed nothing ${BLANK_WAIT / 1000} seconds after the start, so ${job.name} was not uploaded. Run the plan again, or give the screen a "wait" in seconds to take it as it is.`);
  await upload(run.config, run.project, job.file, job.name, job.device.kind, job.locale);
}

/**
 * Prints what a run would do, device by device.
 * @param {Plan} plan
 * @param {Job[]} jobs
 * @param {Map<import("./read.mjs").PlanDevice, { value?: Simulator, problem?: string }>} picked
 */
function printPlan(plan, jobs, picked) {
  for (const device of plan.devices) {
    const mine = jobs.filter((job) => job.device === device);
    if (mine.length === 0) continue;
    const { value: sim, problem } = picked.get(device) ?? {};
    console.log(`${device.display} on ${sim ? `${simulatorLabel(sim)}${sim.booted ? ", booted" : ", to be booted"}` : `no simulator: ${problem}`}`);
    for (const job of mine) {
      const what = `${job.name} (${[job.locale, job.appearance].filter(Boolean).join(", ")})`;
      console.log(`  ${job.skip ? "skip" : "take"} ${what}: ${job.skip ? "the project has it" : `${reachLabel(plan, job)} -> ${fromHere(job.file)}`}`);
    }
  }
}

/**
 * Imports what fastlane snapshot wrote instead of capturing. The project and the screens' names come from the plan
 * when there is one: --plan, or appshots.capture.json in this folder when no project is named.
 * @param {import("../args.mjs").Args} args
 */
async function shootFastlane({ positional, flags }) {
  if (typeof flags.fastlane !== "string") fail("--fastlane needs the folder fastlane snapshot wrote into, usually fastlane/screenshots.");
  if (flags.again) fail("--fastlane uploads all it finds, in place of what the project has, so it takes no --again.");
  const plan = flags.plan !== undefined || (!positional[0] && existsSync(PLAN_FILE)) ? readPlan(typeof flags.plan === "string" ? flags.plan : PLAN_FILE) : null;
  const project = positional[0] ?? plan?.project;
  if (!project) fail(`Name the project the screenshots go to: appshots shoot <project> --fastlane ${flags.fastlane}`);
  const config = loadConfig();
  const { project: stored } = await fetchProject(config, project);
  const locales = runLocales(plan ?? /** @type {Plan} */ ({ locales: null }), project, stored.locales, flags.lang);
  if (flags.only === true) fail("--only needs the names of screenshots, separated by commas, as in --only home,stats.");
  const only = typeof flags.only === "string" ? (plan ? runScreens(plan, flags.only).map((screen) => screen.id) : flags.only.split(",").map((name) => slugify(name.trim()))) : null;
  await importFastlane(config, { project, locales, dir: path.resolve(flags.fastlane), only, ids: plan ? plan.screens.map((screen) => screen.id) : null, dryRun: Boolean(flags["dry-run"]) });
}

/**
 * Takes every screen a capture plan lists, unattended: on each of its devices, in each appearance and language,
 * each brought up by its launch arguments, its link or its UI test, taken once it has come to rest, and uploaded
 * under its name, family and language. What the project has already is left, so a run that stopped half way goes
 * on where it stopped; --again takes all of it again, --only some screens, --lang some languages. --dry-run says
 * what it would do. Each simulator is booted once, the app built once when the plan names its Xcode project, and
 * the status bar set once per device.
 * @param {import("../args.mjs").Args} args
 */
export async function shootPlan(args) {
  const { positional, flags } = args;
  if (positional.length > 1) fail(`${USAGE}\n--only and --lang take ids and codes separated by commas, as in --only home,stats.`);
  for (const flag of BY_HAND) if (flags[flag] !== undefined) fail(`--${flag} is for shooting by hand. A plan says itself where its screens are taken: devices, statusBar and out.`);
  if (flags.fastlane !== undefined) return shootFastlane(args);

  const plan = readPlan(typeof flags.plan === "string" ? flags.plan : PLAN_FILE);
  const project = positional[0] ?? plan.project;
  if (!project) fail(`${plan.file} names no project. Add "project": "<id>" to it, or name one: appshots shoot <project> --plan ${plan.file}. 'appshots projects' lists them.`);
  const config = loadConfig();
  const { project: stored, shots } = await fetchProject(config, project);
  const locales = runLocales(plan, project, stored.locales, flags.lang);
  const screens = runScreens(plan, flags.only);
  const jobs = planJobs(plan, { screens, locales, primary: stored.locales[0], shots, again: Boolean(flags.again) });
  const todo = jobs.filter((job) => !job.skip);
  const devices = plan.devices.filter((device) => jobs.some((job) => job.device === device));

  // Found for every device before anything starts, so that one missing is said before the first screen.
  const listed = await attempt(availableSimulators);
  /** @type {Map<import("./read.mjs").PlanDevice, { value?: Simulator, problem?: string }>} */
  const picked = new Map();
  for (const device of devices) picked.set(device, listed.problem !== undefined ? { problem: listed.problem } : await attempt(() => pickSimulator(device, listed.value)));

  const appearances = plan.appearances ? ` in ${and(plan.appearances)}` : "";
  console.log(`${plan.file}: ${count(jobs.length)} for ${project}, ${screens.length} ${screens.length === 1 ? "screen" : "screens"} in ${and(locales)}${appearances}, on ${and(devices.map((device) => device.display))}`);
  if (flags["dry-run"]) {
    if (plan.app.xcode && todo.some((job) => !job.screen.uitest && !job.screen.app)) console.log(`First builds ${plan.app.scheme ?? "the app's scheme"} from ${fromHere(plan.app.xcode)} and installs it`);
    if (todo.some((job) => job.screen.uitest)) console.log(`First builds the UI tests of ${plan.app.scheme ?? "the app's scheme"} from ${fromHere(plan.app.xcode ?? plan.dir)}`);
    printPlan(plan, jobs, picked);
    const skipped = jobs.length - todo.length;
    return console.log(`Would take ${count(todo.length)}${skipped > 0 ? ` and skip ${skipped} the project has (--again takes them as well)` : ""}. Nothing was captured or uploaded (--dry-run).`);
  }
  if (todo.length === 0) return console.log(`Nothing to take: ${project} has all ${count(jobs.length)} of the plan already. --again takes them again.`);

  const working = devices.filter((device) => todo.some((job) => job.device === device));
  /** @type {Map<import("./read.mjs").PlanDevice, Simulator>} */
  const simulators = new Map();
  for (const device of working) {
    const { value, problem } = picked.get(device) ?? {};
    if (!value) fail(`${device.display}: ${problem}`);
    simulators.set(device, value);
  }
  const launched = todo.filter((job) => !job.screen.uitest);
  const builds = Boolean(plan.app.xcode) && launched.some((job) => !job.screen.app);
  const tests = todo.some((job) => job.screen.uitest);
  /** @type {Run} */
  const run = { plan, config, project, bundleId: plan.app.bundleId, started: new Map() };
  if (builds || tests) {
    run.xcodeProject = planXcodeProject(plan, tests ? "A UI test" : "Building the app");
    run.scheme = await pickScheme(run.xcodeProject, plan.app.scheme, `name the app's in app.scheme of ${plan.file}`);
  }

  // The simulators boot while the app builds, as each takes a while and neither needs the other.
  const first = /** @type {Simulator} */ (simulators.get(working[0]));
  const bootedHere = [...simulators.values()].filter((sim) => !sim.booted);
  const prepare = async () => {
    if (!run.xcodeProject || !run.scheme) return null;
    console.log(`Building ${run.scheme} from ${fromHere(run.xcodeProject)}`);
    const app = builds ? await build(run.xcodeProject, run.scheme, first, false) : null;
    if (tests) await buildForTesting(run.xcodeProject, run.scheme, first);
    return app;
  };
  const [built, ...booted] = await Promise.allSettled([prepare(), ...[...simulators.values()].map((sim) => boot(sim))]);
  for (const outcome of [built, ...booted]) if (outcome.status === "rejected") throw outcome.reason;
  const app = built.status === "fulfilled" ? built.value : null;
  run.bundleId ??= app?.bundleId;

  for (const device of working) {
    const simulator = /** @type {Simulator} */ (simulators.get(device));
    const mine = launched.filter((job) => job.device === device);
    if (app && mine.some((job) => !job.screen.app)) await install(simulator, app.file);
    await checkInstalled(simulator, [...new Set(mine.map((job) => screenApp(plan, job.screen, run.bundleId)).filter((each) => each !== undefined))], plan);
  }

  /** @type {string[]} */
  const taken = [];
  /** @type {Array<{ job: Job, problem: string }>} */
  const failed = [];
  let at = 0;
  for (const device of working) {
    const simulator = /** @type {Simulator} */ (simulators.get(device));
    const mine = todo.filter((job) => job.device === device);
    const work = async () => {
      const before = plan.appearances ? await appearanceOf(simulator) : null;
      /** @type {"light" | "dark" | null} */
      let appearance = before;
      let inRow = 0;
      try {
        for (const [index, job] of mine.entries()) {
          if (job.appearance && job.appearance !== appearance) {
            await setAppearance(simulator, job.appearance);
            appearance = job.appearance;
          }
          console.log(`${++at}/${todo.length} ${job.name} (${[device.display, job.locale, job.appearance].filter(Boolean).join(", ")}): ${reachLabel(plan, job, run.bundleId)}`);
          const { problem } = await attempt(() => take(run, job, simulator));
          if (problem === undefined) {
            taken.push(job.name);
            inRow = 0;
            continue;
          }
          console.error(`appshots: ${problem}`);
          failed.push({ job, problem: problem.split("\n")[0] });
          if (++inRow < FAILURES_IN_A_ROW) continue;
          const rest = mine.slice(index + 1);
          for (const left of rest) failed.push({ job: left, problem: `not tried after ${FAILURES_IN_A_ROW} failures in a row on ${simulator.name}` });
          at += rest.length;
          break;
        }
      } finally {
        // The simulator is left at its home screen, where the next run starts: a link opened while another app is
        // in front can take long enough to run out of time.
        await closeStarted(run, simulator);
        if (before && appearance !== before) await setAppearance(simulator, before);
      }
    };
    if (plan.cleanStatusBar) await withCleanStatusBar(simulator, work);
    else await work();
  }

  const skipped = jobs.length - todo.length;
  console.log(`Taken ${taken.length} of ${count(todo.length)} for ${project}${skipped > 0 ? `; skipped ${skipped} the project has (--again takes them as well)` : ""}.`);
  if (bootedHere.length > 0) console.log(`Booted for this run and still running: ${bootedHere.map((sim) => `${sim.name} (${sim.udid})`).join(", ")}. 'appshots simctl shutdown <udid>' stops one.`);
  if (failed.length > 0) {
    const lines = failed.map(({ job, problem }) => `  ${job.name} (${[job.device.display, job.locale, job.appearance].filter(Boolean).join(", ")}): ${problem}`);
    fail(`${failed.length} of ${count(todo.length)} not taken:\n${lines.join("\n")}\nRun the plan again once that is fixed: it takes only what the project does not have yet.`);
  }
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { build, findXcodeProject, pickScheme } from "../../build.mjs";
import { withCleanStatusBar } from "../../capture/sim.mjs";
import { fail } from "../../fail.mjs";
import { launchPlan } from "../../plan.mjs";
import { readBinaryPlist } from "../../plist.mjs";
import { projectDirs, xcodeProjects } from "../../projects.mjs";
import { availableSimulators, boot, install, installedApps, runSimulator, simctlList, simulatorLabel } from "../../sim.mjs";
import { choose } from "../../util.mjs";
import { xcodeEnv, xcrun } from "../../xcode.mjs";
import { buildUiTests } from "./drive.mjs";
import { footageDisplay } from "./session.mjs";
import { startRecorder } from "./spawn.mjs";

/**
 * The simulator a display's footage is recorded on: the one --sim names, the booted one for a bare --sim, or
 * else the one 'appshots run' would pick, the 6.9-inch iPhone or the 13-inch iPad, which may be created when
 * there is none.
 * @param {string} display
 * @param {Record<string, string | true | undefined>} flags
 */
export async function pickSimulator(display, flags) {
  const family = footageDisplay(display) === "ipad" ? "iPad" : "iPhone";
  const simulator =
    flags.sim === true
      ? { ...choose((await availableSimulators()).filter((sim) => sim.booted), undefined, "simulator", "--sim"), note: "" }
      : await runSimulator({ ...(typeof flags.sim === "string" ? { sim: flags.sim } : {}), ...(family === "iPad" ? { ipad: true } : {}), ...(flags.create ? { create: true } : {}) });
  if (simulator.family && simulator.family !== family) fail(`${simulator.name} is an ${simulator.family}, and the ${display} footage is recorded on an ${family}. Name an ${family} with --sim, or record one display at a time with --display.`);
  return simulator;
}

/**
 * Points to pixels on a simulator's screen, as its device type says: 3 on most iPhones, 2 on an iPad.
 * @param {{ udid: string, family: string }} simulator
 */
async function screenScale(simulator) {
  const list = await simctlList();
  const device = Object.values(list.devices)
    .flat()
    .find((each) => each.udid === simulator.udid);
  const type = list.devicetypes.find((each) => each.identifier === device?.deviceTypeIdentifier);
  let scale = 0;
  try {
    const data = readFileSync(path.join(type.bundlePath, "Contents", "Resources", "capabilities.plist"));
    scale =
      data.toString("latin1", 0, 8) === "bplist00"
        ? Number(/** @type {any} */ (readBinaryPlist(data))?.capabilities?.ScreenDimensionsCapability?.["main-screen-scale"])
        : Number(data.toString("utf8").match(/<key>main-screen-scale<\/key>\s*<(?:integer|real)>([\d.]+)</)?.[1]);
  } catch {}
  return scale > 0 ? scale : simulator.family === "iPad" ? 2 : 3;
}

/**
 * @typedef {object} AppState What a run builds once and installs on each simulator once.
 * @property {Promise<{ file: string | null, bundleId: string, project: string | null, scheme: string | null }> | null} app
 * @property {Set<string>} installed The simulators it is on.
 */

/** @returns {AppState} */
export const appState = () => ({ app: null, installed: new Set() });

/**
 * Builds the app once per run, as 'appshots run' does. Where there is no Xcode project to build, as for an app
 * a toolkit of its own builds, there is nothing to build and the app has to be on the simulator already.
 * @param {{ name: string, udid: string }} simulator What to build for.
 * @param {any} plan
 * @param {Record<string, string | true | undefined>} flags
 * @param {AppState} state
 */
function buildApp(simulator, plan, flags, state) {
  state.app ??= (async () => {
    const found = typeof flags.project === "string" ? [findXcodeProject(flags.project)] : xcodeProjects(projectDirs());
    if (found.length === 0) {
      if (!plan.app?.bundleId) fail(`There is no Xcode project here to build, and the plan does not say the app's bundle id. Run this in the app's folder, or put "bundleId" into the plan's "app".`);
      return { file: null, bundleId: plan.app.bundleId, project: null, scheme: null };
    }
    // More than one is for --project to settle, which findXcodeProject says.
    const project = found.length === 1 ? found[0] : findXcodeProject(undefined);
    const scheme = await pickScheme(project, flags.scheme);
    const built = await build(project, scheme, simulator, Boolean(flags.fresh));
    return { ...built, project, scheme };
  })();
  return state.app;
}

/**
 * Puts the app on a booted simulator once per run, or makes sure it is there when it was not built here.
 * @param {{ name: string, udid: string }} simulator
 * @param {{ file: string | null, bundleId: string }} app
 * @param {AppState} state
 */
async function installApp(simulator, app, state) {
  if (state.installed.has(simulator.udid)) return;
  if (app.file) {
    await install(simulator, app.file);
  } else {
    const apps = await installedApps(simulator.udid);
    if (apps && !apps.some((each) => each.bundleId === app.bundleId)) fail(`${app.bundleId} is not installed on ${simulator.name}. Start it there once with the project's own command, then record again.`);
  }
  state.installed.add(simulator.udid);
}

/**
 * Records a display's footage on a simulator: picks and boots it, builds and installs the app, sets a clean
 * status bar for the whole run and starts the app on each scene in the scene's language.
 * @param {string} display
 * @param {any} plan
 * @param {Record<string, string | true | undefined>} flags
 * @param {AppState} state
 * @returns {Promise<import("./index.mjs").Source>}
 */
export async function simSource(display, plan, flags, state) {
  const simulator = await pickSimulator(display, flags);
  console.log(`Recording ${display} on ${simulatorLabel(simulator)}${simulator.note ?? ""}`);
  // Booting and building take a while each and neither needs the other; both are waited for, so that neither
  // goes on in the background after the other has failed.
  const [booted, built] = await Promise.allSettled([boot(simulator), buildApp(simulator, plan, flags, state)]);
  if (built.status === "rejected") throw built.reason;
  if (booted.status === "rejected") throw booted.reason;
  const app = { ...built.value, bundleId: plan.app?.bundleId ?? built.value.bundleId };
  await installApp(simulator, app, state);
  const scale = await screenScale(simulator);
  const env = await xcodeEnv();
  // What the simulator showed before: a scene that asks for dark or light gets it, the others get this, and
  // the simulator gets it back at the end.
  /** @type {string | null} */
  let before = null;
  /** @type {string | null} */
  let shown = null;
  const setAppearance = async (/** @type {string} */ value) => {
    const result = await xcrun(["simctl", "ui", simulator.udid, "appearance", value]);
    if (result.status !== 0) fail(`Could not set ${simulator.name} to ${value}:\n${result.stderr.trim()}`);
    shown = value;
  };
  return {
    kind: "sim",
    label: simulator.name,
    model: simulator.model,
    os: simulator.os,
    extension: ".mov",
    padded: true,
    scale: () => scale,
    simulator,
    around: (work) =>
      withCleanStatusBar(simulator, async () => {
        const asked = await xcrun(["simctl", "ui", simulator.udid, "appearance"]);
        before = shown = asked.status === 0 && /^(light|dark)$/.test(asked.stdout.trim()) ? asked.stdout.trim() : null;
        try {
          return await work();
        } finally {
          if (before && shown !== before) await setAppearance(before);
        }
      }),
    open: async (scene, locale) => {
      const wanted = scene.launch?.appearance ?? before;
      if (wanted && wanted !== shown) await setAppearance(wanted);
      const { launchArguments } = launchPlan({ lang: locale }, scene.launch?.args ?? []);
      // One that is still running would come to the front as it was, in the language it was started in.
      const result = await xcrun(["simctl", "launch", "--terminate-running-process", simulator.udid, app.bundleId, ...launchArguments]);
      if (result.status !== 0) fail(`Could not launch ${app.bundleId} on ${simulator.name}:\n${result.stderr.trim()}`);
      if (scene.launch?.url) {
        const opened = await xcrun(["simctl", "openurl", simulator.udid, scene.launch.url]);
        if (opened.status !== 0) fail(`Could not open ${scene.launch.url} on ${simulator.name}. Does the app handle that address?\n${opened.stderr.trim()}`);
      }
    },
    record: (file) => startRecorder("simctl", "xcrun", ["simctl", "io", simulator.udid, "recordVideo", "--codec=h264", "--force", file], { env, ready: /Recording started/ }),
    tests: async (scene) => {
      const project = app.project ?? findXcodeProject(flags.project);
      const scheme = scene.drive.scheme ?? app.scheme ?? (await pickScheme(project, flags.scheme));
      return buildUiTests(project, scheme, simulator, Boolean(flags.fresh));
    },
  };
}

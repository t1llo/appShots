import { readFileSync } from "node:fs";
import path from "node:path";
import { fail } from "./fail.mjs";
import { readBinaryPlist } from "./plist.mjs";
import { run } from "./proc.mjs";
import { confirm } from "./prompt.mjs";
import { STORE_BY_HAND, STORE_DISPLAYS } from "./store/displays.mjs";
import { choose } from "./util.mjs";
import { xcodeEnv, xcrun } from "./xcode.mjs";

/** @type {Promise<any> | undefined} */
let listing;

/**
 * Everything simctl knows: the devices of each runtime, the device types and the runtimes. Asked once per
 * command, as each asking takes a moment, and again after something here has changed it.
 */
export function simctlList() {
  listing ??= (async () => {
    const result = await xcrun(["simctl", "list", "--json"]);
    if (result.status !== 0) fail(`simctl failed. Is Xcode installed?\n${result.stderr.trim()}`);
    return JSON.parse(result.stdout);
  })().catch((error) => {
    listing = undefined;
    throw error;
  });
  return listing;
}

/** After a boot or a new simulator, what simctl said before is out of date. */
export function forgetSimulators() {
  listing = undefined;
}

/** @returns {Promise<Array<{ name: string, udid: string }>>} */
export async function bootedSimulators() {
  const list = await simctlList();
  return Object.values(list.devices)
    .flat()
    .filter((device) => device.state === "Booted")
    .map((device) => ({ name: device.name, udid: device.udid }));
}

/** @type {Map<string, { width: number, height: number } | null>} */
const screens = new Map();

/**
 * The size of the screenshots a device type takes, in pixels, as its bundle says. Null when it does not say.
 * @param {{ identifier: string, bundlePath?: string } | undefined} type
 */
export function screenOf(type) {
  if (!type?.bundlePath) return null;
  if (!screens.has(type.identifier)) {
    let size = null;
    try {
      const data = readFileSync(path.join(type.bundlePath, "Contents", "Resources", "capabilities.plist"));
      let width;
      let height;
      if (data.toString("latin1", 0, 8) === "bplist00") {
        const screen = /** @type {any} */ (readBinaryPlist(data))?.capabilities?.ScreenDimensionsCapability;
        width = screen?.["main-screen-width"];
        height = screen?.["main-screen-height"];
      } else {
        const text = data.toString("utf8");
        const number = (key) => Number(text.match(new RegExp(`<key>${key}</key>\\s*<(?:integer|real)>([\\d.]+)<`))?.[1]);
        width = number("main-screen-width");
        height = number("main-screen-height");
      }
      if (width > 0 && height > 0) size = { width, height };
    } catch {}
    screens.set(type.identifier, size);
  }
  return screens.get(type.identifier) ?? null;
}

/**
 * @typedef {object} Simulator
 * @property {string} name
 * @property {string} udid
 * @property {boolean} booted
 * @property {string} model The device type's name, which the user cannot change.
 * @property {string} family
 * @property {string} os
 * @property {{ width: number, height: number } | null} screen
 */

/**
 * Every iPhone and iPad simulator that can be booted, with the model it stands for and its iOS version.
 * @returns {Promise<Simulator[]>}
 */
export async function availableSimulators() {
  const list = await simctlList();
  const models = new Map(list.devicetypes.map((type) => [type.identifier, type]));
  return list.runtimes
    .filter((runtime) => runtime.isAvailable && runtime.name.startsWith("iOS"))
    .flatMap((runtime) =>
      (list.devices[runtime.identifier] ?? [])
        .filter((device) => device.isAvailable)
        .map((device) => {
          // The name is the user's to choose, so the model is read from the device type.
          const model = models.get(device.deviceTypeIdentifier);
          return { name: device.name, udid: device.udid, booted: device.state === "Booted", model: model?.name ?? device.name, family: model?.productFamily ?? "", os: runtime.version, screen: screenOf(model) };
        }),
    );
}

/**
 * The kinds of simulator 'appshots run' starts, with the size of screenshot the store asks for first. Models are
 * told apart by that size, and by their names where a device type does not say its size.
 */
export const SIM_KINDS = {
  iphone: { label: "iPhone", flag: "", family: "iPhone", store: "iPhone Pro Max", size: [1320, 2868], wanted: [/Pro Max/, /Plus/] },
  duo: { label: "iPhone Duo", flag: " --duo", family: "iPhone", store: "iPhone Duo", size: [2007, 2853], wanted: [/Duo/] },
  ipad: { label: "iPad", flag: " --ipad", family: "iPad", store: "13-inch iPad Pro", size: [2064, 2752], wanted: [/^iPad Pro 13-inch/, /13-inch|12\.9-inch/, /^iPad Pro/] },
};

/** @param {Record<string, unknown>} flags */
export const simKind = (flags) => (flags.duo ? "duo" : flags.ipad ? "ipad" : "iphone");

/**
 * Whether a screen is the size the store asks for, upright or on its side.
 * @param {{ width: number, height: number } | null} screen
 * @param {number[]} size
 */
const storeSized = (screen, [width, height]) => Boolean(screen) && ((screen.width === width && screen.height === height) || (screen.width === height && screen.height === width));

/**
 * The simulator 'appshots run' uses when none is named: one whose screenshots have the size the store asks for
 * (the iPhone Pro Max, the iPhone Duo, the 13-inch iPad Pro), on the newest iOS and of the newest model. Null when
 * there is no simulator of that kind at all; `fallback` says that another model had to do.
 * @param {Simulator[]} simulators
 * @param {keyof typeof SIM_KINDS} kind
 */
export function recommendedSimulator(simulators, kind) {
  const { wanted, family, size } = SIM_KINDS[kind];
  const rank = (sim) => {
    const at = wanted.findIndex((pattern) => pattern.test(sim.model));
    const named = at === -1 ? wanted.length : at;
    // Where the device type does not say its size, the first name stands for it.
    return (sim.screen ? storeSized(sim.screen, size) : named === 0) ? 0 : 1 + named;
  };
  // The 18 in "iPhone 18 Pro Max", the 5 in "iPad Pro 13-inch (M5)".
  const number = (sim) => Number(sim.model.replace(/[\d.]+-inch/, "").match(/\d+/)?.[0] ?? 0);
  const [best] = simulators
    // The Duo is an iPhone by family but never stands in for one, and nothing stands in for it.
    .filter((sim) => sim.family === family && /Duo/.test(sim.model) === (kind === "duo"))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.os.localeCompare(a.os, undefined, { numeric: true }) ||
        number(b) - number(a) ||
        // One that still has its model's name before one somebody set up for a purpose of their own.
        (b.name === b.model) - (a.name === a.model) ||
        b.booted - a.booted ||
        a.name.localeCompare(b.name),
    );
  return best ? { ...best, fallback: rank(best) > 0 } : null;
}

/** @param {Simulator} sim */
export const simulatorLabel = (sim) => `${sim.name}${sim.name === sim.model ? "" : `, an ${sim.model}`}, iOS ${sim.os}`;

/**
 * The App Store display whose size a screen's screenshots have as they are, as in "the 6.9-inch iPhone display".
 * Null for any other size, which the Studio scales to the displays of an export all the same.
 * @param {{ width: number, height: number } | null} screen
 */
export function displayOf(screen) {
  for (const [folder, [, width, height]] of Object.entries(STORE_DISPLAYS)) {
    const [family, inches] = folder.split("-");
    if (storeSized(screen, [width, height]) && family !== "mac") return `the ${inches}-inch ${family === "ipad" ? "iPad" : "iPhone"} display`;
  }
  if (storeSized(screen, SIM_KINDS.duo.size)) return `the ${STORE_BY_HAND["iphone-duo"]} display`;
  return null;
}

/** @param {{ screen: { width: number, height: number } | null }} sim */
export const screenLabel = (sim) => {
  if (!sim.screen) return "";
  const display = displayOf(sim.screen);
  return `, screenshots ${sim.screen.width}x${sim.screen.height} ${display ? `for ${display}` : "(no store display has this size)"}`;
};

/**
 * A simulator of the size the store asks for that could be made: the newest such device type on the newest iOS
 * that runs it. Null when Xcode has no such device type, or no iOS for it.
 * @param {keyof typeof SIM_KINDS} kind
 */
export async function storeModel(kind) {
  const { family, size } = SIM_KINDS[kind];
  const list = await simctlList();
  const number = (type) => Number(type.name.replace(/[\d.]+-inch/, "").match(/\d+/)?.[0] ?? 0);
  const types = list.devicetypes
    .filter((type) => type.productFamily === family && /Duo/.test(type.name) === (kind === "duo") && storeSized(screenOf(type), size))
    .sort((a, b) => number(b) - number(a) || a.name.localeCompare(b.name));
  const runtimes = list.runtimes
    .filter((runtime) => runtime.isAvailable && runtime.name.startsWith("iOS"))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  for (const type of types) {
    // A runtime that says nothing about the device types it runs is taken at its word for all of them.
    const runtime = runtimes.find((each) => !each.supportedDeviceTypes || each.supportedDeviceTypes.some((supported) => supported.identifier === type.identifier));
    if (runtime) return { type, runtime };
  }
  return null;
}

/**
 * Makes a simulator of the store's size, named after its model, and returns it.
 * @param {{ type: any, runtime: any }} model
 */
async function createSimulator({ type, runtime }) {
  const result = await xcrun(["simctl", "create", type.name, type.identifier, runtime.identifier]);
  if (result.status !== 0) fail(`Could not create an ${type.name} simulator:\n${result.stderr.trim()}`);
  const udid = result.stdout.trim();
  forgetSimulators();
  console.log(`Created the simulator ${type.name}, iOS ${runtime.version}  (${udid})`);
  const simulator = (await availableSimulators()).find((sim) => sim.udid === udid);
  if (!simulator) fail(`simctl created ${udid}, but does not list it. Run this again.`);
  return { ...simulator, fallback: false };
}

/**
 * The simulator run and boot use: the one --sim names, or the one recommendedSimulator picks. When none has the
 * size the store asks for and Xcode can make one, --create makes it, a person at the Terminal is asked, and
 * anyone else is told how.
 * @param {Record<string, string | true>} flags
 */
export async function runSimulator(flags) {
  const simulators = await availableSimulators();
  if (typeof flags.sim === "string") return { ...choose(simulators, flags.sim, "simulator", "--sim"), fallback: false, note: "" };
  if (flags.duo && flags.ipad) fail("Use --duo or --ipad, not both.");
  const kind = simKind(flags);
  const simulator = recommendedSimulator(simulators, kind);
  if (simulator && !simulator.fallback) return { ...simulator, note: "" };
  const model = await storeModel(kind);
  if (model) {
    const asked = flags.create || (await confirm(`No ${SIM_KINDS[kind].store} simulator is installed, which is the size the store asks for. Create one, an ${model.type.name} on iOS ${model.runtime.version}?`));
    if (asked) return { ...(await createSimulator(model)), note: "" };
  } else if (flags.create) {
    fail(`This Xcode has no ${SIM_KINDS[kind].store} to create. Add a newer iOS simulator in Xcode under Settings > Components.`);
  }
  if (!simulator) fail(`No ${SIM_KINDS[kind].label} simulator is installed. Add an iOS simulator in Xcode under Settings > Components.`);
  const create = model ? `; --create adds an ${model.type.name}` : "";
  return { ...simulator, note: `. No ${SIM_KINDS[kind].store} is installed, which is the size the store asks for${create}` };
}

/**
 * Boots a simulator and waits until it is ready, also when someone else has only just started it.
 * @param {{ name: string, udid: string, booted: boolean }} simulator
 */
export async function boot(simulator) {
  if (!simulator.booted) await xcrun(["simctl", "boot", simulator.udid]);
  const result = await xcrun(["simctl", "bootstatus", simulator.udid, "-b"], { timeout: 600000 });
  forgetSimulators();
  if (result.status !== 0) fail(`Could not boot ${simulator.name}:\n${`${result.stderr}${result.stdout}`.trim()}`);
  // The window is there for the user to watch; everything works without it.
  if (process.env.APPSHOTS_NO_WINDOW !== "1") await run("open", ["-a", "Simulator"]);
}

/**
 * The apps the user put on a simulator, as opposed to the ones iOS comes with. Null when it does not say.
 * @param {string} udid
 */
export async function installedApps(udid) {
  // A simulator that is busy can take its time over this, and 'appshots check' is meant to be quick.
  const list = await run("xcrun", ["simctl", "listapps", udid], { env: await xcodeEnv(), timeout: 4000 });
  // simctl prints a property list in the old text form, which plutil turns into JSON.
  const json = list.status === 0 ? await run("plutil", ["-convert", "json", "-o", "-", "-"], { input: list.stdout }) : null;
  if (json?.status !== 0) return null;
  return Object.values(JSON.parse(json.stdout))
    .filter((app) => app.ApplicationType === "User" && app.CFBundleIdentifier && !app.CFBundleIdentifier.endsWith(".xctrunner"))
    .map((app) => ({ name: app.CFBundleDisplayName ?? app.CFBundleName ?? app.CFBundleIdentifier, bundleId: app.CFBundleIdentifier }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

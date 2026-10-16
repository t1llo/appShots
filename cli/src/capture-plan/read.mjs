import { readFileSync } from "node:fs";
import path from "node:path";
import { fail } from "../fail.mjs";
import { FAMILY_DISPLAYS, PLAN_DISPLAYS } from "./displays.mjs";

/** The file `shoot --plan` reads when it is not given another. */
export const PLAN_FILE = "appshots.capture.json";

const KIND_LABELS = { iphone: "an iPhone", duo: "an iPhone Duo", ipad: "an iPad" };
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const LOCALE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const APPEARANCES = ["light", "dark"];
const PLAN_FIELDS = ["$schema", "version", "project", "app", "devices", "locales", "appearances", "statusBar", "wait", "out", "screens"];
const APP_FIELDS = ["bundleId", "xcode", "scheme", "args"];
const SCREEN_FIELDS = ["id", "app", "launch", "uitest", "wait", "devices"];

/**
 * @typedef {object} PlanDevice
 * @property {string} display A key of PLAN_DISPLAYS.
 * @property {import("./displays.mjs").PlanKind} kind
 * @property {string} [sim] The simulator the plan names for it, by name or udid.
 *
 * @typedef {object} PlanScreen
 * @property {string} id What the screenshot is called, and what slides place it by.
 * @property {string} [app] The bundle id of the app it is in, where that is not the plan's.
 * @property {string[]} args Launch arguments, after the plan's own.
 * @property {string} [url] A link opened once the app runs, or in the simulator when no app is started.
 * @property {string} [uitest] A UI test that brings the screen up, as Target/Class/method.
 * @property {number | null} wait Seconds to wait instead of watching the screen come to rest.
 * @property {string[] | null} devices The displays it is taken on, when not all of the plan's.
 *
 * @typedef {object} Plan
 * @property {string} file As it was named, for what is printed.
 * @property {string} dir The folder of the file, which the paths in it start from.
 * @property {string} [project]
 * @property {{ bundleId?: string, xcode?: string, scheme?: string, args: string[] }} app
 * @property {PlanDevice[]} devices
 * @property {string[] | null} locales Null for every language of the project.
 * @property {Array<"light" | "dark"> | null} appearances Null to leave the simulator's as it is.
 * @property {boolean} cleanStatusBar
 * @property {number | null} wait
 * @property {string} out
 * @property {PlanScreen[]} screens
 */

/** @param {unknown} value */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** @param {unknown} value */
const isSeconds = (value) => typeof value === "number" && value >= 0 && value <= 600;

/**
 * A list of strings, or the problems with it, each named by where it is.
 * @param {unknown} value
 * @param {string} where
 * @param {string[]} errors
 */
function strings(value, where, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${where}: has to be a list of strings, as in ["-appshots", "stats"].`);
    return [];
  }
  const list = [];
  for (const [at, each] of value.entries()) {
    if (typeof each === "string") list.push(each);
    else errors.push(`${where}[${at}]: has to be a string.`);
  }
  return list;
}

/**
 * The display a word of a plan stands for: a family's for iphone, duo or ipad, else the word itself.
 * @param {string} word
 */
const displayOf = (word) => {
  const lower = word.toLowerCase();
  return Object.hasOwn(FAMILY_DISPLAYS, lower) ? FAMILY_DISPLAYS[/** @type {keyof typeof FAMILY_DISPLAYS} */ (lower)] : lower;
};

/**
 * Checks what a plan file holds and fills in what it leaves out. Every problem is named by where it is in the
 * file, as in `screens[2].launch.url`, and all of them are said at once.
 * @param {unknown} json
 * @param {string} file
 * @returns {{ plan: Plan, errors: string[] }}
 */
export function checkPlan(json, file) {
  /** @type {string[]} */
  const errors = [];
  const dir = path.dirname(path.resolve(file));
  /** @type {Plan} */
  const plan = { file, dir, app: { args: [] }, devices: [], locales: null, appearances: null, cleanStatusBar: true, wait: null, out: path.join(dir, "raw-shots"), screens: [] };
  if (!isObject(json)) return { plan, errors: ['The plan has to be a JSON object, as in { "project": "<id>", "app": { "bundleId": "com.example.app" }, "screens": [{ "id": "home" }] }.'] };
  const given = /** @type {Record<string, any>} */ (json);
  for (const key of Object.keys(given)) if (!PLAN_FIELDS.includes(key)) errors.push(`${key}: a plan has no such field. It has ${PLAN_FIELDS.slice(1).join(", ")}.`);
  if (given.version !== undefined && given.version !== 1) errors.push("version: has to be 1, the only version there is.");

  if (given.project !== undefined) {
    if (typeof given.project === "string" && given.project) plan.project = given.project;
    else errors.push("project: needs the id of an appShots project, as a string. 'appshots projects' lists them.");
  }

  if (given.app !== undefined) {
    if (!isObject(given.app)) errors.push('app: has to be an object, as in { "bundleId": "com.example.app" }.');
    else {
      for (const key of Object.keys(given.app)) if (!APP_FIELDS.includes(key)) errors.push(`app.${key}: app has no such field. It has ${APP_FIELDS.join(", ")}.`);
      const { bundleId, xcode, scheme, args } = given.app;
      if (bundleId !== undefined) {
        if (typeof bundleId === "string" && BUNDLE_ID.test(bundleId)) plan.app.bundleId = bundleId;
        else errors.push("app.bundleId: needs the app's bundle id, as in com.example.app. 'appshots check' lists the apps installed on each booted simulator.");
      }
      if (xcode !== undefined) {
        if (typeof xcode === "string" && xcode) plan.app.xcode = path.resolve(dir, xcode);
        else errors.push('app.xcode: needs the path of the Xcode workspace or project, or of the folder it is in, from the plan\'s folder, as in "." or "ios/App.xcworkspace".');
      }
      if (scheme !== undefined) {
        if (typeof scheme === "string" && scheme) plan.app.scheme = scheme;
        else errors.push("app.scheme: needs the name of the scheme that builds the app.");
      }
      if (args !== undefined) plan.app.args = strings(args, "app.args", errors);
      if (scheme !== undefined && xcode === undefined) errors.push("app.scheme: goes with app.xcode, the project it is a scheme of.");
    }
  }

  const devices = given.devices === undefined ? ["iphone"] : given.devices;
  if (!Array.isArray(devices) || devices.length === 0) errors.push('devices: needs a list of displays, as in ["iphone", "ipad"]. Left out, it is ["iphone"].');
  else {
    /** @type {Map<string, string>} */
    const families = new Map();
    for (const [at, entry] of devices.entries()) {
      const where = `devices[${at}]`;
      const word = typeof entry === "string" ? entry : isObject(entry) ? entry.display : undefined;
      if (isObject(entry)) {
        for (const key of Object.keys(entry)) if (!["display", "sim"].includes(key)) errors.push(`${where}.${key}: a device has no such field. It has display and sim.`);
        if (entry.sim !== undefined && (typeof entry.sim !== "string" || !entry.sim)) errors.push(`${where}.sim: needs the name or udid of a simulator, as 'appshots devices' and 'appshots check' list them.`);
      }
      if (typeof word !== "string") {
        errors.push(`${where}: needs a display, as in "iphone" or { "display": "ipad-13", "sim": "iPad Pro 13-inch (M5)" }.`);
        continue;
      }
      const display = displayOf(word);
      if (display === "mac" || display.startsWith("mac-")) {
        errors.push(`${where}: a plan takes its screens in simulators. A Mac app's window is captured with 'appshots capture --mac <app>'.`);
        continue;
      }
      if (!Object.hasOwn(PLAN_DISPLAYS, display)) {
        errors.push(`${where}: "${word}" is no display. Use iphone, duo or ipad, or one of ${Object.keys(PLAN_DISPLAYS).join(", ")}.`);
        continue;
      }
      const { kind } = PLAN_DISPLAYS[display];
      const before = families.get(kind);
      if (before) {
        errors.push(`${where}: ${display} is ${KIND_LABELS[kind]} display, like ${before}. A project keeps one screenshot of each name per family and language, and the server scales it to the family's other sizes, so list one of them.`);
        continue;
      }
      families.set(kind, `${display} in devices[${at}]`);
      plan.devices.push({ display, kind, ...(isObject(entry) && typeof entry.sim === "string" && entry.sim ? { sim: entry.sim } : {}) });
    }
  }

  if (given.locales !== undefined) {
    if (!Array.isArray(given.locales) || given.locales.length === 0) errors.push('locales: needs a list of language codes, as in ["en", "de", "pt-BR"]. Left out, it is every language of the project.');
    else {
      plan.locales = [];
      for (const [at, code] of given.locales.entries()) {
        if (typeof code !== "string" || !LOCALE.test(code)) errors.push(`locales[${at}]: needs a language code, such as de or pt-BR.`);
        else if (plan.locales.some((other) => other.toLowerCase() === code.toLowerCase())) errors.push(`locales[${at}]: ${code} is in the list already.`);
        else plan.locales.push(code);
      }
    }
  }

  if (given.appearances !== undefined) {
    const list = typeof given.appearances === "string" ? [given.appearances] : given.appearances;
    if (!Array.isArray(list) || list.length === 0 || list.some((each) => !APPEARANCES.includes(each))) errors.push('appearances: needs "light", "dark" or both, as in ["light", "dark"]. Left out, the simulator stays as it is.');
    else if (new Set(list).size !== list.length) errors.push("appearances: names one twice.");
    else plan.appearances = list;
  }

  if (given.statusBar !== undefined) {
    if (given.statusBar === "clean" || given.statusBar === "as-is") plan.cleanStatusBar = given.statusBar === "clean";
    else errors.push('statusBar: is "clean", for 9:41 with full battery and signal (the default), or "as-is".');
  }
  if (given.wait !== undefined) {
    if (isSeconds(given.wait)) plan.wait = given.wait;
    else errors.push("wait: needs a number of seconds, as in 3. Left out, each screen is taken once it has stopped changing.");
  }
  if (given.out !== undefined) {
    if (typeof given.out === "string" && given.out) plan.out = path.resolve(dir, given.out);
    else errors.push("out: needs the folder the screenshots are saved in, from the plan's folder.");
  }

  if (!Array.isArray(given.screens) || given.screens.length === 0) errors.push('screens: needs a list of screens, as in [{ "id": "home" }, { "id": "stats", "launch": ["-appshots", "stats"] }].');
  else {
    /** @type {Map<string, string>} */
    const ids = new Map();
    for (const [at, entry] of given.screens.entries()) {
      const screen = checkScreen(entry, `screens[${at}]`, plan, errors);
      if (!screen) continue;
      const first = ids.get(screen.id);
      if (first) errors.push(`screens[${at}].id: "${screen.id}" is the id of ${first} already.`);
      else {
        ids.set(screen.id, `screens[${at}]`);
        plan.screens.push(screen);
      }
    }
  }
  return { plan, errors };
}

/**
 * @param {unknown} entry
 * @param {string} where
 * @param {Plan} plan
 * @param {string[]} errors
 * @returns {PlanScreen | null}
 */
function checkScreen(entry, where, plan, errors) {
  if (!isObject(entry)) {
    errors.push(`${where}: has to be an object, as in { "id": "home" }.`);
    return null;
  }
  const given = /** @type {Record<string, any>} */ (entry);
  const count = errors.length;
  for (const key of Object.keys(given)) if (!SCREEN_FIELDS.includes(key)) errors.push(`${where}.${key}: a screen has no such field. It has ${SCREEN_FIELDS.join(", ")}.`);
  if (typeof given.id !== "string" || !ID.test(given.id)) errors.push(`${where}.id: needs the screenshot's name: lowercase letters, digits, - and _, at most 40 of them, as in "home".`);
  /** @type {PlanScreen} */
  const screen = { id: given.id, args: [], wait: null, devices: null };
  if (given.app !== undefined) {
    if (typeof given.app === "string" && BUNDLE_ID.test(given.app)) screen.app = given.app;
    else errors.push(`${where}.app: needs the bundle id of the app the screen is in, as in com.apple.Preferences.`);
  }
  if (given.launch !== undefined) {
    const list = Array.isArray(given.launch);
    const launch = list ? { args: given.launch } : given.launch;
    if (!isObject(launch)) errors.push(`${where}.launch: has to be the launch arguments, as in ["-appshots", "stats"], or an object with args and url.`);
    else {
      for (const key of Object.keys(launch)) if (!["args", "url"].includes(key)) errors.push(`${where}.launch.${key}: launch has no such field. It has args and url.`);
      if (launch.args !== undefined) screen.args = strings(launch.args, list ? `${where}.launch` : `${where}.launch.args`, errors);
      if (launch.url !== undefined) {
        if (typeof launch.url === "string" && /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/.test(launch.url)) screen.url = launch.url;
        else errors.push(`${where}.launch.url: needs a link with its scheme, as in myapp://stats or https://example.com/stats.`);
      }
    }
  }
  if (given.uitest !== undefined) {
    if (typeof given.uitest === "string" && /^[^/\s]+\/[^/\s]+(\/[^/\s]+)?$/.test(given.uitest)) screen.uitest = given.uitest;
    else errors.push(`${where}.uitest: names a UI test as Target/Class/method, as in AppUITests/ScreenshotTests/testStats.`);
    if (given.launch !== undefined || given.app !== undefined) errors.push(`${where}: takes uitest or launch and app, not both. A UI test starts the app itself.`);
  }
  if (given.wait !== undefined) {
    if (isSeconds(given.wait)) screen.wait = given.wait;
    else errors.push(`${where}.wait: needs a number of seconds, as in 3.`);
  }
  if (given.devices !== undefined) {
    if (!Array.isArray(given.devices) || given.devices.length === 0) errors.push(`${where}.devices: needs a list of the plan's displays, as in ["ipad"]. Left out, the screen is taken on all of them.`);
    else {
      screen.devices = [];
      for (const [at, word] of given.devices.entries()) {
        const lower = typeof word === "string" ? word.toLowerCase() : "";
        const device = plan.devices.find((each) => each.display === displayOf(lower) || each.kind === lower);
        if (device) screen.devices.push(device.display);
        else errors.push(`${where}.devices[${at}]: ${JSON.stringify(word)} is not one of the plan's devices: ${plan.devices.map((each) => each.display).join(", ") || "none"}.`);
      }
    }
  }
  if (!screen.uitest && !screen.url && !screen.app && !plan.app.bundleId && !plan.app.xcode && errors.length === count) {
    errors.push(`${where}: says nowhere how to reach it. Give the app in app.bundleId or app.xcode, a link in launch.url, or a UI test in uitest.`);
  }
  return errors.length === count ? screen : null;
}

/**
 * Reads a plan file, or fails with everything that is wrong with it.
 * @param {string} file
 * @returns {Plan}
 */
export function readPlan(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail(`No capture plan at ${file}. Write one as the appShots docs describe under Command line, Capture plans, or name it: --plan <file>.`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
  const { plan, errors } = checkPlan(json, file);
  if (errors.length > 0) fail(`${file} is not a capture plan that can be run:\n${errors.map((error) => `  ${error}`).join("\n")}`);
  return plan;
}

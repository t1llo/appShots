import path from "node:path";
import { fail } from "../fail.mjs";
import { recommendedSimulator, SIM_KINDS } from "../sim.mjs";
import { choose } from "../util.mjs";
import { FAMILY_DISPLAYS, PLAN_DISPLAYS, sizeRank } from "./displays.mjs";

/** @typedef {import("./read.mjs").Plan} Plan */
/** @typedef {import("./read.mjs").PlanDevice} PlanDevice */
/** @typedef {import("./read.mjs").PlanScreen} PlanScreen */
/** @typedef {import("../sim.mjs").Simulator} Simulator */

/**
 * The language of a project a code stands for, as the server decides it: the same code, else the project's one of
 * that language, else the bare language of a code with a region. Null when the project has none of them.
 * @param {string[]} locales
 * @param {string} wanted
 */
export function projectLocale(locales, wanted) {
  const lower = wanted.toLowerCase();
  const language = (code) => code.toLowerCase().split("-")[0];
  return locales.find((code) => code.toLowerCase() === lower) ?? locales.find((code) => language(code) === lower) ?? locales.find((code) => code.toLowerCase() === language(wanted)) ?? null;
}

/**
 * The languages a run takes, as the project spells them: the plan's, or the project's when it lists none, and of
 * those only the ones --lang names.
 * @param {Plan} plan
 * @param {string} project
 * @param {string[]} locales The project's.
 * @param {string | true | undefined} only The value of --lang: codes, separated by commas.
 */
export function runLocales(plan, project, locales, only) {
  const wanted = plan.locales ?? locales;
  const resolved = wanted.map((code) => {
    const found = projectLocale(locales, code);
    if (!found) fail(`Project ${project} has no language "${code}", which the plan lists. Its languages are ${locales.join(", ")}. Add it first: in the Studio under Languages, or with the update_project tool.`);
    return found;
  });
  const twice = resolved.find((code, at) => resolved.indexOf(code) !== at);
  if (twice) fail(`The plan's languages ${wanted.filter((code, at) => resolved[at] === twice).join(" and ")} are both ${twice} in project ${project}. List it once.`);
  if (only === undefined) return resolved;
  if (typeof only !== "string") fail(`--lang needs one or more of the plan's languages, as in --lang ${resolved.slice(0, 2).join(",")}.`);
  const picked = only.split(",").map((code) => {
    const found = code.trim() ? projectLocale(resolved, code.trim()) : null;
    if (!found) fail(`--lang ${code.trim()}: the plan takes ${resolved.join(", ")}.`);
    return found;
  });
  return resolved.filter((code) => picked.includes(code));
}

/**
 * The screens a run takes: all of the plan's, or the ones --only names.
 * @param {Plan} plan
 * @param {string | true | undefined} only
 */
export function runScreens(plan, only) {
  if (only === undefined) return plan.screens;
  if (typeof only !== "string") fail(`--only needs the ids of screens, separated by commas, as in --only ${plan.screens.slice(0, 2).map((screen) => screen.id).join(",")}.`);
  const ids = only.split(",").map((id) => id.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !plan.screens.some((screen) => screen.id === id));
  if (unknown.length > 0) fail(`--only ${unknown.join(",")}: the plan has no such screen. Its screens are ${plan.screens.map((screen) => screen.id).join(", ")}.`);
  return plan.screens.filter((screen) => ids.includes(screen.id));
}

/** @param {[number, number]} size */
const sizeLabel = ([width, height]) => `${width}x${height}`;

/**
 * The simulator a plan's device is taken on: the one it names, or else one whose screenshots have the display's
 * size, the size the server exports first, then the newest iOS, one that runs already, and the newest model.
 * @param {PlanDevice} device
 * @param {Simulator[]} simulators
 * @returns {Simulator}
 */
export function pickSimulator(device, simulators) {
  const { display, kind } = device;
  const sizes = PLAN_DISPLAYS[display].sizes;
  if (device.sim) {
    const named = choose(simulators, device.sim, "simulator", "the plan's devices");
    if (named.screen && sizeRank(named.screen, display) === -1) fail(`${named.name} takes ${named.screen.width}x${named.screen.height} screenshots, which are not ${display}'s (${sizes.map(sizeLabel).join(", ")}). Name a simulator of that size in the plan, or another display.`);
    return named;
  }
  // The 18 in "iPhone 18 Pro Max", the 5 in "iPad Pro 13-inch (M5)".
  const number = (sim) => Number(sim.model.replace(/[\d.]+-inch/, "").match(/\d+/)?.[0] ?? 0);
  const [best] = simulators
    .filter((sim) => sizeRank(sim.screen, display) !== -1)
    .sort(
      (a, b) =>
        sizeRank(a.screen, display) - sizeRank(b.screen, display) ||
        b.os.localeCompare(a.os, undefined, { numeric: true }) ||
        Number(b.booted) - Number(a.booted) ||
        number(b) - number(a) ||
        Number(b.name === b.model) - Number(a.name === a.model) ||
        a.name.localeCompare(b.name),
    );
  if (best) return best;
  // A device type that does not say its size is known by its name, for the size each family is designed at.
  const family = /** @type {keyof typeof SIM_KINDS | undefined} */ (Object.keys(FAMILY_DISPLAYS).find((each) => FAMILY_DISPLAYS[each] === display));
  const named = family ? recommendedSimulator(simulators, family) : null;
  if (named && !named.fallback) return named;
  const hint = family
    ? `'appshots boot${SIM_KINDS[family].flag} --create' adds one when this Xcode has the model.`
    : `Add one in Xcode under Window > Devices and Simulators, or list ${kind} instead: the server scales the screenshots of ${FAMILY_DISPLAYS[kind]} to ${display}.`;
  fail(`No simulator takes ${display} screenshots (${sizes.map(sizeLabel).join(" or ")}). ${hint}`);
}

/**
 * @typedef {object} Job
 * @property {PlanDevice} device
 * @property {"light" | "dark" | null} appearance
 * @property {string} locale The project's code of the language.
 * @property {PlanScreen} screen
 * @property {string} name What the screenshot is called in the project.
 * @property {string} file Where it is saved.
 * @property {boolean} skip Whether the project has it already, so this run leaves it.
 */

/**
 * Every screenshot a run is made of, in the order it takes them: device by device, so each simulator is set up
 * once; within one, appearance by appearance, as switching it redraws everything; then language by language and
 * screen by screen. The first appearance keeps the screen's own name and any other adds its own to it, as in home
 * and home-dark. What the project has already under that name, family and language is skipped, unless `again`.
 * @param {Plan} plan
 * @param {{ screens: PlanScreen[], locales: string[], primary: string, shots: Array<{ name: string, device: string, locale?: string }>, again: boolean }} run
 * @returns {Job[]}
 */
export function planJobs(plan, { screens, locales, primary, shots, again }) {
  const appearances = plan.appearances ?? [null];
  // The project files its first language's screenshots under no language.
  const inProject = (name, kind, locale) => shots.some((shot) => shot.name === name && shot.device === kind && (shot.locale ?? primary) === locale);
  /** @type {Job[]} */
  const jobs = [];
  for (const device of plan.devices)
    for (const [index, appearance] of appearances.entries())
      for (const locale of locales)
        for (const screen of screens) {
          if (screen.devices && !screen.devices.includes(device.display)) continue;
          const name = index === 0 ? screen.id : `${screen.id}-${appearance}`;
          const file = path.join(plan.out, locale, device.display, `${name}.png`);
          jobs.push({ device, appearance, locale, screen, name, file, skip: !again && inProject(name, device.kind, locale) });
        }
  return jobs;
}

/**
 * What the app is started with for a language, as 'appshots launch --lang' does it.
 * @param {string} locale
 */
export const languageArguments = (locale) => ["-AppleLanguages", `(${locale})`, "-AppleLocale", locale.replaceAll("-", "_")];

/**
 * The app a screen is in: its own, or the plan's. Undefined for a link opened in whatever the simulator opens it
 * with, and for a UI test, which starts the app itself.
 * @param {Plan} plan
 * @param {PlanScreen} screen
 * @param {string} [built] The bundle id of the app the plan built, when it names none.
 */
export const screenApp = (plan, screen, built) => (screen.uitest ? undefined : (screen.app ?? plan.app.bundleId ?? (plan.app.xcode ? (built ?? "<the app the plan builds>") : undefined)));

/**
 * How a job reaches its screen, in words, for --dry-run and for the line before each capture.
 * @param {Plan} plan
 * @param {Job} job
 * @param {string} [built]
 */
export function reachLabel(plan, job, built) {
  const { screen } = job;
  if (screen.uitest) return `run the UI test ${screen.uitest}`;
  const app = screenApp(plan, screen, built);
  const steps = [];
  if (app) steps.push(`launch ${[app, ...(screen.app ? [] : plan.app.args), ...screen.args].join(" ")}`);
  if (screen.url) steps.push(`open ${screen.url}${app ? "" : " in the simulator's own language"}`);
  return steps.join(", then ");
}

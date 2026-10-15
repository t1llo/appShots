import path from "node:path";
import { hasLanguage } from "./api.mjs";
import { build, findXcodeProject, pickScheme } from "./build.mjs";
import { captureSettled, withCleanStatusBar } from "./capture/sim.mjs";
import { loadConfig } from "./config.mjs";
import { fail } from "./fail.mjs";
import { fromHere } from "./projects.mjs";
import { shotDevice, shotLanguage, shotTarget } from "./shot.mjs";
import { availableSimulators, boot, bootedSimulators, runSimulator, simulatorLabel } from "./sim.mjs";
import { toolkits } from "./toolkits.mjs";
import { upload } from "./upload.mjs";
import { choose } from "./util.mjs";
import { xcrun } from "./xcode.mjs";

/**
 * What the options of run and launch ask for once the app is installed: appearance, language, the arguments
 * after --, and the screenshot to take. Checked here, before anything slow starts.
 * @param {Record<string, string | true>} flags
 * @param {string[]} launchArguments
 */
export function launchPlan(flags, launchArguments) {
  if (flags.dark && flags.light) fail("Use --dark or --light, not both.");
  const lang = shotLanguage(flags);
  if (flags.capture !== undefined && typeof flags.capture !== "string") fail("--capture needs the name of the screenshot, as in: --capture stats");
  if (flags.to !== undefined && typeof flags.to !== "string") fail("--to needs the id of a project. 'appshots projects' lists them.");
  if (flags.to && !flags.capture) fail("--to says where a screenshot goes, so it needs --capture <name> as well.");
  // Left out, the screen is watched until it comes to rest.
  const wait = flags.wait === undefined ? null : typeof flags.wait === "string" ? Number(flags.wait) : NaN;
  if (wait !== null && !(wait >= 0 && wait <= 600)) fail("--wait needs a number of seconds, as in: --wait 5");
  const language = lang ? ["-AppleLanguages", `(${lang})`, "-AppleLocale", lang.replaceAll("-", "_")] : [];
  return {
    appearance: flags.dark ? "dark" : flags.light ? "light" : null,
    launchArguments: [...launchArguments, ...language],
    capture: /** @type {string | undefined} */ (flags.capture),
    wait,
    out: flags.out,
    to: /** @type {string | undefined} */ (flags.to),
    device: shotDevice(flags),
    language: lang,
    // Read now, so a missing setup is said before the build and not after it.
    config: flags.to ? loadConfig() : null,
  };
}

/**
 * @param {{ name: string, udid: string }} simulator
 * @param {string} bundleId
 * @param {ReturnType<typeof launchPlan>} plan
 */
async function startApp(simulator, bundleId, plan) {
  // capture and launch find the only booted simulator by themselves; among several they have to be told which.
  const which = (await bootedSimulators()).length > 1 ? ` --sim ${simulator.udid}` : "";
  const start = async () => {
    if (plan.appearance) {
      const result = await xcrun(["simctl", "ui", simulator.udid, "appearance", plan.appearance]);
      if (result.status !== 0) fail(`Could not set ${simulator.name} to ${plan.appearance}:\n${result.stderr.trim()}`);
    }
    // One that is still running would come to the front with the arguments it was started with.
    const result = await xcrun(["simctl", "launch", "--terminate-running-process", simulator.udid, bundleId, ...plan.launchArguments]);
    if (result.status !== 0) fail(`Could not launch ${bundleId} on ${simulator.name}. Is it installed there? 'appshots run' builds and installs it.\n${result.stderr.trim()}`);
    console.log(`Running ${bundleId} on ${simulator.name} (${simulator.udid})`);
  };
  if (!plan.capture) {
    await start();
    return console.log(`Next: appshots capture --name <name> --project <project> --clean${which}`);
  }

  const shot = shotTarget({ name: plan.capture, out: plan.out });
  // The status bar is set before the app starts, so the launch animation and the first data are all there is to wait for.
  await withCleanStatusBar(simulator, async () => {
    await start();
    await captureSettled(simulator, shot.file, plan.wait);
  });
  if (plan.config && plan.to) await upload(plan.config, plan.to, shot.file, shot.name, plan.device, plan.language);
  console.log(`Next: appshots launch ${bundleId} --capture <name> --to ${plan.to ?? "<project>"}${which} -- <launch arguments>`);
}

/**
 * Builds the app in this folder, installs it on a simulator and starts it. The simulator boots while the app
 * builds, as each takes a while and neither needs the other.
 * @param {Record<string, string | true>} flags
 * @param {string[]} launchArguments
 */
export async function run(flags, launchArguments) {
  const plan = launchPlan(flags, launchArguments);
  if (plan.config && plan.to) await hasLanguage(plan.config, plan.to, plan.language);
  const project = findXcodeProject(flags.project);
  // The schemes and the simulators are asked for at once; the simulators' answer is kept for what follows.
  const [scheme] = await Promise.all([pickScheme(project, flags.scheme), availableSimulators()]);
  const simulator = await runSimulator(flags);
  console.log(`Building ${scheme} from ${fromHere(project)} for ${simulatorLabel(simulator)}${simulator.note}`);
  // Both are waited for, so that neither goes on in the background after the other has failed.
  const [booted, built] = await Promise.allSettled([boot(simulator), build(project, scheme, simulator, Boolean(flags.fresh))]);
  if (built.status === "rejected") throw built.reason;
  if (booted.status === "rejected") throw booted.reason;
  const app = built.value;
  const installed = await xcrun(["simctl", "install", simulator.udid, app.file]);
  if (installed.status !== 0) fail(`Could not install ${path.basename(app.file)} on ${simulator.name}:\n${installed.stderr.trim()}`);
  await startApp(simulator, app.bundleId, plan);
}

/**
 * @param {string} bundleId
 * @param {Record<string, string | true>} flags
 * @param {string[]} launchArguments
 */
export async function launch(bundleId, flags, launchArguments) {
  // An easy slip after capture, where --project is the place to upload to; here it would do nothing at all.
  if (flags.project !== undefined) fail("launch has no --project. The project a screenshot goes to is --to <project>, together with --capture <name>.");
  const plan = launchPlan(flags, launchArguments);
  if (plan.config && plan.to) await hasLanguage(plan.config, plan.to, plan.language);
  await startApp(choose(await bootedSimulators(), flags.sim, "simulator", "--sim"), bundleId, plan);
}

/**
 * Boots the simulator run would use, for an app that its own toolkit builds.
 * @param {Record<string, string | true>} flags
 */
export async function bootCommand(flags) {
  const simulator = await runSimulator(flags);
  await boot(simulator);
  console.log(`Booted ${simulatorLabel(simulator)}  (${simulator.udid})${simulator.note}`);
  const which = (await bootedSimulators()).length > 1 ? ` --sim ${simulator.udid}` : "";
  const own = toolkits(process.cwd())
    .find((kit) => kit.simulator)
    ?.simulator?.replaceAll("<udid>", simulator.udid)
    .replaceAll("<simulator>", simulator.name);
  console.log(`Next: ${own ? `'${own}' in the background` : "start the app there with the project's own command, which takes this udid"}, then: appshots capture --name <name> --project <project> --clean${which}`);
}

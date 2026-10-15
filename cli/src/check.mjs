import { serverStatus } from "./api.mjs";
import { obviousScheme, schemesOf } from "./build.mjs";
import { connectedDevices } from "./capture/device.mjs";
import { findBrowser } from "./capture/web.mjs";
import { attempt } from "./fail.mjs";
import { host, run } from "./proc.mjs";
import { fromHere, projectDirs, xcodeProjects } from "./projects.mjs";
import { availableSimulators, installedApps, recommendedSimulator, screenLabel, SIM_KINDS, simulatorLabel, storeModel } from "./sim.mjs";
import { storeStatus } from "./store/asc.mjs";
import { appFolders, toolkitLines, toolkits } from "./toolkits.mjs";
import { skillStatus } from "./update.mjs";
import { xcode } from "./xcode.mjs";

/**
 * One report of what there is to work with, so an agent sees it in a single call. Nothing missing makes it
 * fail: each line says what is there, or what to do about it. Everything is asked at once and printed in order,
 * so the report takes as long as its slowest question.
 */
export async function check() {
  const projects = xcodeProjects(projectDirs());
  const mac = host.platform === "darwin";
  const server = serverStatus();
  const skill = skillStatus();
  const store = storeStatus();
  const version = mac ? xcode().then(({ env }) => run("xcodebuild", ["-version"], { env })) : null;
  const schemes = projects.length === 1 ? attempt(() => schemesOf(projects[0])) : null;
  const simulators = mac ? attempt(availableSimulators) : null;
  // A device that is locked or asleep can keep devicectl waiting, and this is meant to be quick.
  const devices = mac ? attempt(() => connectedDevices({ timeout: 15000 })) : null;
  // Whatever is not printed in the end is still waited for, so that nothing is left running.
  const settled = Promise.allSettled([server, skill, store, version, schemes, simulators, devices]);
  try {
    await report({ projects, server, skill, store, version, schemes, simulators, devices });
  } finally {
    await settled;
  }
}

/**
 * @param {object} probes
 * @param {string[]} probes.projects
 * @param {Promise<string>} probes.server
 * @param {Promise<string | null>} probes.skill
 * @param {Promise<string>} probes.store
 * @param {Promise<import("./proc.mjs").Result> | null} probes.version
 * @param {Promise<{ value?: string[], problem?: string }> | null} probes.schemes
 * @param {Promise<{ value?: import("./sim.mjs").Simulator[], problem?: string }> | null} probes.simulators
 * @param {Promise<{ value?: Array<{ name: string, udid: string, model: string, transport: string }>, problem?: string }> | null} probes.devices
 */
async function report(probes) {
  const { projects } = probes;
  console.log(`Server: ${await probes.server}`);
  const skill = await probes.skill;
  if (skill) console.log(`Skill: ${skill}`);
  console.log(`App Store Connect: ${await probes.store}`);

  const kits = toolkits(process.cwd());
  const known = kits.filter((kit) => !kit.unsure);
  // A simulator is where the toolkit's own command puts the app, when it has one for iOS.
  const starter = kits.some((kit) => kit.simulator) ? "boot" : "run";
  // An app that runs in a window or a browser only has no use for Xcode or a simulator.
  const apart = projects.length === 0 && known.length > 0 && starter === "run";

  const version = await probes.version;
  const isXcode = version?.status === 0;
  if (version && isXcode) {
    const { dir, picked } = await xcode();
    // xcode-select points at the Command Line Tools, which have no simulators; the Xcode found instead is used.
    const note = picked ? ". xcode-select points at the Command Line Tools, so appshots uses this Xcode" : "";
    console.log(`Xcode: ${dir.replace(/\/Contents\/Developer\/?$/, "")}, version ${version.stdout.match(/Xcode (\S+)/)?.[1] ?? "unknown"}${note}`);
  } else if (version) {
    console.log(apart ? "Xcode: not found, and this project needs none." : "Xcode: not found. Install Xcode from the App Store; the Command Line Tools alone cannot build an app or run a simulator.");
  } else {
    console.log("Xcode: this is not a Mac. Simulators, devices and Mac windows need one. 'appshots capture --web <address>' takes a web app's pages here, and 'appshots upload' takes screenshots you already have.");
  }

  if (projects.length === 0 && known.length > 0) {
    console.log("Project: no Xcode workspace or project here, and 'appshots run' builds only those. This app is captured as its toolkit runs it:");
  } else if (projects.length === 0) {
    console.log("Project: nothing recognised in this folder. Run this in your app's folder. 'appshots run' builds an Xcode workspace or project, and --project <path> points at one elsewhere. An app made with anything else is started by its own command and captured where it runs: 'appshots capture' in the simulator, 'appshots capture --mac <app>' in a window on this Mac, 'appshots capture --web <address>' in a browser.");
    const below = appFolders(process.cwd());
    const list = below.slice(0, 8).map((entry) => `${entry.folder} (${entry.made.join(", ")})`).join(", ");
    if (below.length > 0) console.log(`  Apps below this folder: ${list}${below.length > 8 ? `, and ${below.length - 8} more` : ""}. Run 'appshots check' in the one whose screens you want.`);
  } else if (projects.length > 1) {
    console.log(`Project: several in this folder, so 'appshots run' needs --project <path>: ${projects.map(fromHere).join(", ")}`);
  } else {
    const [project] = projects;
    const schemes = isXcode && probes.schemes ? await probes.schemes : { problem: "Its schemes cannot be read without Xcode." };
    const scheme = schemes.value && obviousScheme(project, schemes.value);
    if (schemes.problem !== undefined) console.log(`Project: ${fromHere(project)}. ${schemes.problem.replace(/\s+/g, " ")}`);
    else if (schemes.value.length === 0) console.log(`Project: ${fromHere(project)}, no scheme. Open it in Xcode and share one under Product > Scheme > Manage Schemes.`);
    else if (schemes.value.length === 1) console.log(`Project: ${fromHere(project)}, scheme ${scheme}`);
    else console.log(`Project: ${fromHere(project)}, schemes ${schemes.value.join(", ")}. ${scheme ? `'appshots run' builds ${scheme}` : "Name the app's with 'appshots run --scheme <name>'"}`);
  }

  const simulators = isXcode && probes.simulators ? await probes.simulators : { problem: "unknown without Xcode" };
  for (const kit of kits) {
    const head = projects.length > 0 && kit.simulator ? ", so its own command starts the app rather than 'appshots run'" : "";
    console.log(`Made with ${kit.name} (${kit.sign})${head}:`);
    for (const line of toolkitLines(kit, simulators.value ? recommendedSimulator(simulators.value, "iphone") : null, isXcode)) console.log(line);
  }
  if (kits.some((kit) => kit.web) || (projects.length === 0 && kits.length === 0)) {
    const browser = findBrowser();
    console.log(browser ? `Browser: ${browser.name}, which draws the pages for 'appshots capture --web'` : "Browser: none found. 'appshots capture --web' draws pages with Chrome, Chromium, Edge or Brave. Install one, or point APPSHOTS_BROWSER at a Chromium browser's program.");
  }
  // Nothing below concerns an app that never runs in a simulator or on a device.
  if (apart) return;

  if (simulators.problem !== undefined) {
    console.log(`Simulators: ${simulators.problem.split("\n")[0]}`);
  } else {
    const all = simulators.value;
    const recommended = new Set();
    const lines = ["Simulators:"];
    for (const [kind, { label, flag, store }] of Object.entries(SIM_KINDS)) {
      const simulator = recommendedSimulator(all, /** @type {keyof typeof SIM_KINDS} */ (kind));
      const command = `'appshots ${starter}${flag}'`;
      if (!simulator) {
        // Few apps need the Duo, so its absence is not worth a line.
        if (kind !== "duo") lines.push(`  ${label}: none. Add an iOS simulator in Xcode under Settings > Components.`);
        continue;
      }
      recommended.add(simulator.udid);
      const state = simulator.booted ? "booted" : `not booted, ${command} boots it`;
      const model = simulator.fallback ? (await attempt(() => storeModel(/** @type {keyof typeof SIM_KINDS} */ (kind)))).value : null;
      const create = model ? `; '${`appshots ${starter}${flag}`} --create' adds an ${model.type.name}` : "";
      const note = simulator.fallback ? `. No ${store} is installed, which is the size the store asks for${create}` : "";
      lines.push(`  ${label}: ${simulatorLabel(simulator)}${screenLabel(simulator)}, ${state}  (${simulator.udid})${note}`);
    }
    for (const simulator of all.filter((sim) => sim.booted && !recommended.has(sim.udid))) {
      lines.push(`  Also booted: ${simulatorLabel(simulator)}${screenLabel(simulator)}  (${simulator.udid})`);
    }

    // What is installed already needs no build. The simulators 'appshots run' uses come first.
    const booted = all.filter((sim) => sim.booted).sort((a, b) => Number(recommended.has(b.udid)) - Number(recommended.has(a.udid)));
    const which = booted.length > 1 ? " --sim <simulator>" : "";
    if (booted.length === 0) {
      lines.push(starter === "run" ? "Apps: no simulator is booted. 'appshots run' boots one, then builds and installs the app in this folder." : "Apps: no simulator is booted. 'appshots boot' boots one, and the project's own command builds and installs the app there.");
    } else {
      lines.push(`Apps: these are installed and start without a build, with 'appshots launch <bundle id>${which}'`);
      // Each simulator is a question to simctl, and a long list helps nobody.
      const shown = booted.slice(0, 6);
      const installed = await Promise.all(shown.map((simulator) => installedApps(simulator.udid).catch(() => null)));
      for (const [at, simulator] of shown.entries()) {
        const apps = installed[at];
        const more = apps && apps.length > 8 ? `, and ${apps.length - 8} more` : "";
        const list = apps?.slice(0, 8).map((app) => `${app.name} (${app.bundleId})`).join(", ");
        if (!apps) lines.push(`  ${simulator.name}: it is busy and did not answer. 'appshots simctl listapps ${simulator.udid}' asks again`);
        else lines.push(`  ${simulator.name}: ${list ? `${list}${more}` : starter === "run" ? "none of your own. 'appshots run' builds and installs the app in this folder" : "none of your own yet"}`);
      }
      if (booted.length > 6) lines.push(`  ${booted.length - 6} more booted simulators are not listed.`);
    }
    for (const line of lines) console.log(line);
  }

  const devices = isXcode && probes.devices ? await probes.devices : { problem: "unknown without Xcode" };
  if (devices.problem !== undefined) {
    console.log(`Devices: ${devices.problem.split("\n")[0]}`);
  } else if (devices.value.length === 0) {
    console.log("Devices: none connected. To capture from an iPhone or iPad, plug it in, unlock it and trust this Mac.");
  } else {
    console.log("Devices:");
    for (const device of devices.value) console.log(`  ${device.name}  ${device.model}  ${device.transport}  (${device.udid})`);
  }
}

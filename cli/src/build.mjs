import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { BUILD_CACHE } from "./config.mjs";
import { fail } from "./fail.mjs";
import { fromHere, projectDirs, xcodeProjects } from "./projects.mjs";
import { toolkits } from "./toolkits.mjs";
import { slugify } from "./util.mjs";
import { xcodebuild } from "./xcode.mjs";

/** @param {string} project */
const container = (project) => [project.endsWith(".xcworkspace") ? "-workspace" : "-project", project];

/** @param {string | true | undefined} given */
export function findXcodeProject(given) {
  if (typeof given === "string" && /\.(xcworkspace|xcodeproj)\/?$/.test(given)) {
    if (!existsSync(given)) fail(`No such workspace or project: ${given}`);
    return path.resolve(given);
  }
  const found = xcodeProjects(typeof given === "string" ? [path.resolve(given)] : projectDirs());
  if (found.length === 1) return found[0];
  if (found.length > 1) fail(`Several workspaces or projects are here; pick one with --project <path>:\n${found.map((file) => `  ${fromHere(file)}`).join("\n")}`);
  if (typeof given === "string") fail(`No Xcode workspace or project in ${given}. For run, --project is the workspace or project to build; the project a screenshot goes to is --to <project>.`);
  const kits = toolkits(process.cwd()).filter((kit) => !kit.unsure);
  fail(
    kits.length > 0
      ? `No Xcode workspace or project here: this app is made with ${kits.map((kit) => kit.name).join(" and ")}, and 'appshots run' builds Xcode projects only. Start it with its own command and capture it where it runs. 'appshots check' gives the commands.`
      : "No Xcode workspace or project in this folder or in ./ios. Run this in your app's folder, or point at it with --project <path>. An app made with something else is started by its own command; 'appshots check' says how.",
  );
}

/**
 * What xcodebuild wrote about a failure, without the timestamped log lines it mixes in.
 * @param {{ stderr: string }} result
 */
const complaint = (result) => result.stderr.split("\n").filter((line) => line.trim() && !/^\d{4}-\d\d-\d\d /.test(line)).join("\n");

/** @param {string} project */
export async function schemesOf(project) {
  const result = await xcodebuild(["-list", "-json", ...container(project)]);
  if (result.status !== 0) fail(`xcodebuild could not list the schemes of ${path.basename(project)}:\n${complaint(result)}`);
  const start = result.stdout.search(/^\{/m);
  if (start === -1) fail(`xcodebuild did not list the schemes of ${path.basename(project)}:\n${complaint(result) || result.stdout.trim()}`);
  const list = JSON.parse(result.stdout.slice(start));
  // A workspace lists a name once for every project that has a scheme called that.
  return [...new Set((list.workspace ?? list.project)?.schemes ?? [])];
}

/**
 * The scheme that needs no asking: the only one, or the one named like the workspace or project.
 * @param {string} project
 * @param {string[]} schemes
 */
export function obviousScheme(project, schemes) {
  if (schemes.length === 1) return schemes[0];
  const name = path.parse(project).name.toLowerCase();
  return schemes.find((scheme) => scheme.toLowerCase() === name) ?? null;
}

/**
 * The scheme to build. One that is named is taken at its word, as listing the schemes of a large workspace takes
 * seconds; the build says when there is no such scheme.
 * @param {string} project
 * @param {string | true | undefined} given
 */
export async function pickScheme(project, given) {
  if (typeof given === "string") return given;
  const schemes = await schemesOf(project);
  const list = schemes.map((scheme) => `  ${scheme}`).join("\n");
  if (schemes.length === 0) fail(`${path.basename(project)} has no scheme. Open it in Xcode and share one under Product > Scheme > Manage Schemes.`);
  const scheme = obviousScheme(project, schemes);
  if (!scheme) fail(`${path.basename(project)} has several schemes; pick the app's with --scheme <name>:\n${list}`);
  return scheme;
}

/**
 * The iOS app among the targets a scheme builds. A scheme may build extensions, frameworks or a watch app as well.
 * @param {{ stdout: string }} settings
 * @param {string} scheme
 */
function appOf(settings, scheme) {
  const start = settings.stdout.search(/^\[/m);
  if (start === -1) return null;
  let targets = [];
  try {
    targets = JSON.parse(settings.stdout.slice(start));
  } catch {
    return null;
  }
  const apps = targets.map((entry) => entry.buildSettings).filter((entry) => entry.PRODUCT_TYPE === "com.apple.product-type.application" && entry.PLATFORM_NAME === "iphonesimulator");
  return apps.find((entry) => entry.TARGET_NAME === scheme) ?? apps[0] ?? null;
}

/**
 * Builds the scheme for the simulator and returns the app it made. The build goes into Xcode's own build
 * folder, so what the user has just run from Xcode is compiled already, Swift packages included. With
 * `fresh` it goes into a folder of ours instead, the same one every time, apart from Xcode's.
 * @param {string} project
 * @param {string} scheme
 * @param {{ udid: string }} simulator
 * @param {boolean} fresh
 */
export async function build(project, scheme, simulator, fresh) {
  const name = `${slugify(path.parse(project).name)}-${createHash("sha256").update(project).digest("hex").slice(0, 8)}`;
  const log = path.join(BUILD_CACHE, `${name}.log`);
  const target = [...container(project), "-scheme", scheme, "-configuration", "Debug", "-destination", `platform=iOS Simulator,id=${simulator.udid}`, ...(fresh ? ["-derivedDataPath", path.join(BUILD_CACHE, name)] : [])];
  mkdirSync(BUILD_CACHE, { recursive: true });
  const started = Date.now();
  // The settings say where the app will be. They are read while it builds, leaving the packages to the build;
  // where that does not work, they are read again once it is done.
  const early = xcodebuild([...target, "-showBuildSettings", "-json", "-skipPackageUpdates", "-disableAutomaticPackageResolution"]).catch(() => null);
  // Straight into the log: xcodebuild writes far more than anyone wants to read while it works.
  const output = openSync(log, "w");
  let result;
  try {
    result = await xcodebuild([...target, "build"], { stdio: ["ignore", output, output], timeout: 0 });
  } finally {
    closeSync(output);
  }
  if (result.status !== 0) {
    await early;
    const text = readFileSync(log, "utf8");
    if (/does not contain a scheme named/.test(text)) {
      const schemes = await schemesOf(project);
      fail(`${path.basename(project)} has no scheme "${scheme}". Its schemes:\n${schemes.map((each) => `  ${each}`).join("\n")}`);
    }
    // A build folder takes one build at a time, and Xcode holds it while it builds.
    if (/database is locked|unable to attach DB/.test(text)) fail(`Xcode is building ${scheme} right now and holds its build folder. Wait for that build to finish and run this again, or pass --fresh for a build kept apart from Xcode's.`);
    // What Xcode offers instead of the simulator it was asked for says what kind of app this is.
    const offered = text.split("Available destinations")[1] ?? "";
    if (/platform:macOS/.test(offered) && !/platform:iOS/.test(offered)) {
      fail(`${scheme} is a Mac app, and a Mac app runs on this Mac, not in a simulator. Build and open it, then capture its window:\n  xcodebuild -scheme ${scheme} -configuration Debug -derivedDataPath build build\n  open build/Build/Products/Debug/*.app\n  appshots capture --mac <the app's name> --name <name> --project <id>`);
    }
    const lines = text.split("\n").map((line) => line.trimEnd()).filter(Boolean);
    // Swift repeats each error, indented, under the line of code it is about, and xcodebuild once more in its summary.
    const mentions = lines.filter((line) => line.includes("error:"));
    const flush = mentions.filter((line) => !/^\s/.test(line));
    const errors = [...new Set(flush.length > 0 ? flush : mentions)];
    const shown = errors.length > 0 ? errors.slice(0, 30) : lines.slice(-30);
    fail(`The build of ${scheme} failed:\n${shown.join("\n")}${errors.length > 30 ? `\n(and ${errors.length - 30} more errors)` : ""}\nFull log: ${log}`);
  }

  const settings = await early;
  let app = settings?.status === 0 ? appOf(settings, scheme) : null;
  if (!app) {
    const again = await xcodebuild([...target, "-showBuildSettings", "-json"]);
    if (again.status !== 0) fail(`Could not read the build settings of ${scheme}:\n${complaint(again)}`);
    app = appOf(again, scheme);
  }
  if (!app) fail(`The scheme ${scheme} builds no iOS app. Pick the app's scheme with --scheme <name>.`);
  const file = path.join(app.TARGET_BUILD_DIR, app.WRAPPER_NAME);
  if (!existsSync(file)) fail(`The build succeeded, but there is no app at ${file}. Full log: ${log}`);
  console.log(`Built ${app.WRAPPER_NAME} in ${Math.round((Date.now() - started) / 1000)} s`);
  return { file, bundleId: app.PRODUCT_BUNDLE_IDENTIFIER };
}
